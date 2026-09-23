"""Training corpus for the AgriConnect scratch LLM.

The model is trained from random initialization. The examples teach request
planning; live prices, stock and forecasts are always fetched by backend tools.
"""
import json
import random

PRODUCTS = [
    "tomato","potato","onion","brinjal","carrot","cabbage","cauliflower",
    "spinach","rice","wheat","maize","chilli","banana","mango","coconut",
    "turmeric","groundnut","sugarcane","cotton",
]

def plan(intent, query="", product="", days=7, destination="", open_page=False):
    return {"requests":[{"intent":intent,"query":query,"product":product,"days":days,
                         "destination":destination,"open":open_page}]}

def build_training_rows():
    rows=[]
    product_templates={
        "product_search":[
            "show {p}","find {p}","i need {p}","need some {p}","where can i buy {p}",
            "looking for {p}","do you have {p}","is {p} available","give me {p}",
            "show me fresh {p}","can i buy {p}","want to buy {p}","{p} please",
            "where is {p}","search for {p}","get me {p}",
        ],
        "cheapest_product":[
            "cheap {p}","cheaper {p}","cheep {p}","lowest price {p}","low price {p}",
            "most affordable {p}","find cheap {p}","which {p} is cheapest",
            "show cheapest {p}","best price for {p}","i want cheaper {p}",
            "{p} at the lowest price","find me the cheapest {p}",
        ],
        "demand_forecast":[
            "{p} demand this week","what is the demand forecast for {p}",
            "how much {p} will sell this week","will {p} demand increase",
            "forecast demand for {p}","how is demand for {p}",
            "predict {p} demand","{p} demand next week","how much demand for {p}",
        ],
    }
    for p in PRODUCTS:
        for intent, templates in product_templates.items():
            for t in templates:
                text=t.format(p=p)
                rows.append((text,plan(intent,text,p,7,"",False)))
        for text in [
            f"go to {p} page to buy", f"open {p} page", f"take me to {p} to buy",
            f"open cheapest {p} for buying", f"i want to buy {p} open the page",
        ]:
            rows.append((text,plan("cheapest_product",text,p,7,"",True)))

    destinations=["marketplace","products","orders","cart","wishlist","subscriptions",
                  "traceability","home","farmer dashboard","analytics","ai predictions",
                  "delivery","route"]
    # Multi-intent examples: one user message can produce multiple tool requests.
    multi=[
        ("cheap tomato and what is its demand this week", [
            plan("cheapest_product","cheap tomato","tomato",7,"",False),
            plan("demand_forecast","tomato demand this week","tomato",7,"",False),
        ]),
        ("find cheap onions then open the marketplace", [
            plan("cheapest_product","cheap onions","onion",7,"",False),
            plan("navigate","marketplace","","7","marketplace",True),
        ]),
        ("show tomato price and open the product", [
            plan("product_search","tomato price","tomato",7,"",True),
        ]),
    ]
    for text, requests in multi:
        flat=[]
        for item in requests: flat.extend(item["requests"])
        rows.append((text, {"requests": flat}))

    for d in destinations:
        for verb in ["open","go to","take me to","show me","bring me to"]:
            rows.append((f"{verb} {d}",plan("navigate",d,"",7,d.replace(" ","_"),True)))

    project=[
        ("what is agriconnect","overview"),("what does agriconnect do","overview"),
        ("what ai features does agriconnect have","ai features"),
        ("what is demand forecasting","ai features"),("how does delivery work","delivery"),
        ("what is traceability","traceability"),("what are subscriptions","subscriptions"),
        ("what is b2b","b2b"),("what technology does the project use","technology"),
        ("is this a farm marketplace","overview"),("tell me about the project","overview"),
    ]
    for text,query in project:
        rows.append((text,plan("project_information",query)))

    for text in ["hello","hi","hey","help me","what can you do","i need help"]:
        rows.append((text,plan("general",text)))

    # Common misspellings and conversational variants.
    variants=[]
    for text,answer in rows:
        replacements=[
            ("tomato","tomatoo"),("cheap","cheep"),("price","prce"),
            ("product","prodct"),("demand","demnd"),("show","shw"),
            ("where","wher"),("buy","by"),("cheapest","cheapestt"),
        ]
        for a,b in random.sample(replacements, k=min(2,len(replacements))):
            if a in text:
                variants.append((text.replace(a,b),answer))
    rows.extend(variants)
    return rows

def build_training_texts():
    # Keep the exact answer compact so the model learns the complete JSON target.
    return [
        f"USER: {text}\nASSISTANT: {json.dumps(answer,separators=(',',':'))}"
        for text,answer in build_training_rows()
    ]
