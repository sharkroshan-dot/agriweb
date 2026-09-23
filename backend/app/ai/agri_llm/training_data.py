"""Synthetic instruction data for the first AgriConnect LLM training run."""
import json

PRODUCTS=["tomato","potato","onion","brinjal","carrot","cabbage","cauliflower","spinach","rice","wheat","maize","chilli"]

def _examples():
    rows=[]
    for p in PRODUCTS:
        rows += [
            (f"show me {p}",{"requests":[{"intent":"product_search","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"find {p}",{"requests":[{"intent":"product_search","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"i need {p}",{"requests":[{"intent":"product_search","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"where can i buy {p}",{"requests":[{"intent":"product_search","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"cheap {p}",{"requests":[{"intent":"cheapest_product","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"cheaper {p}",{"requests":[{"intent":"cheapest_product","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"lowest price {p}",{"requests":[{"intent":"cheapest_product","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"show cheapest {p}",{"requests":[{"intent":"cheapest_product","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"go to {p} page to buy",{"requests":[{"intent":"cheapest_product","query":p,"product":p,"days":7,"destination":"","open":True}]}),
            (f"{p} demand this week",{"requests":[{"intent":"demand_forecast","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"what is the demand forecast for {p}",{"requests":[{"intent":"demand_forecast","query":p,"product":p,"days":7,"destination":"","open":False}]}),
            (f"how much {p} will sell this week",{"requests":[{"intent":"demand_forecast","query":p,"product":p,"days":7,"destination":"","open":False}]}),
        ]
    for name in ["marketplace","products","orders","cart","wishlist","subscriptions","traceability","home"]:
        rows += [(f"open {name}",{"requests":[{"intent":"navigate","query":name,"product":"","days":7,"destination":name,"open":True}]}),
                 (f"go to {name}",{"requests":[{"intent":"navigate","query":name,"product":"","days":7,"destination":name,"open":True}]}),
                 (f"take me to {name}",{"requests":[{"intent":"navigate","query":name,"product":"","days":7,"destination":name,"open":True}]})]
    rows += [
        ("what is agriconnect",{"requests":[{"intent":"project_information","query":"overview","product":"","days":7,"destination":"","open":False}]}),
        ("what ai features does agriconnect have",{"requests":[{"intent":"project_information","query":"ai features","product":"","days":7,"destination":"","open":False}]}),
        ("how does delivery work",{"requests":[{"intent":"project_information","query":"delivery","product":"","days":7,"destination":"","open":False}]}),
        ("what is traceability",{"requests":[{"intent":"project_information","query":"traceability","product":"","days":7,"destination":"","open":False}]}),
        ("what technology does the project use",{"requests":[{"intent":"project_information","query":"technology","product":"","days":7,"destination":"","open":False}]}),
        ("hello",{"requests":[{"intent":"general","query":"hello","product":"","days":7,"destination":"","open":False}]}),
        ("help me",{"requests":[{"intent":"general","query":"help","product":"","days":7,"destination":"","open":False}]})
    ]
    return rows

def build_training_texts():
    return [f"USER: {u}\nASSISTANT: {json.dumps(a,separators=(',',':'))}" for u,a in _examples()]
