"""Train AgriConnectLLM from random initialization.

The corpus combines hand-written intent examples with a repository-derived
capability/navigation corpus. No pretrained language model is loaded.
"""
import argparse
import random
from pathlib import Path
import torch
from torch.utils.data import Dataset, DataLoader, random_split

from app.ai.agri_llm.config import CONFIG
from app.ai.agri_llm.model import AgriConnectLLM
from app.ai.agri_llm.tokenizer import ByteTokenizer
from app.ai.agri_llm.training_data import build_training_texts
from app.ai.agri_llm.corpus_builder import training_texts as repository_training_texts

class LMDataset(Dataset):
    def __init__(self, texts, tokenizer, max_len):
        self.rows=[]
        for text in texts:
            ids=tokenizer.encode(text)[:max_len]
            if len(ids)<3:
                continue
            x=ids[:-1]
            y=ids[1:]
            pad=max_len-1-len(x)
            if pad>0:
                x += [tokenizer.pad_id]*pad
                y += [-100]*pad
            self.rows.append((torch.tensor(x,dtype=torch.long),torch.tensor(y,dtype=torch.long)))
    def __len__(self): return len(self.rows)
    def __getitem__(self,i): return self.rows[i]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--epochs",type=int,default=12)
    ap.add_argument("--batch-size",type=int,default=8)
    ap.add_argument("--lr",type=float,default=3e-4)
    ap.add_argument("--device",default="auto")
    ap.add_argument("--repo-root",default=None)
    ap.add_argument("--seed",type=int,default=42)
    args=ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device=torch.device("cuda" if args.device!="cpu" and torch.cuda.is_available() else "cpu")

    backend_root=Path(__file__).resolve().parents[1]
    repo_root=Path(args.repo_root).resolve() if args.repo_root else backend_root.parent

    texts=build_training_texts()
    try:
        texts += repository_training_texts(repo_root)
    except Exception as exc:
        print(f"Repository corpus discovery skipped: {exc}")

    # Controlled noise improves robustness to common conversational typing errors.
    augmented=list(texts)
    for text in texts:
        if "\nASSISTANT:" not in text:
            continue
        user, answer=text.split("\nASSISTANT:",1)
        phrase=user[6:]
        candidates=[
            phrase.replace("tomato","tomatoo"),
            phrase.replace("cheap","cheep"),
            phrase.replace("price","prce"),
            phrase.replace("product","prodct"),
            phrase.replace("demand","demnd"),
            phrase.replace("delivery","delivary"),
            phrase.replace("where","wher"),
            phrase.replace("buy","by"),
        ]
        for variant in random.sample(candidates,k=min(2,len(candidates))):
            if variant != phrase:
                augmented.append(f"USER: {variant}\nASSISTANT:{answer}")

    # Remove duplicate examples before training.
    texts=list(dict.fromkeys(augmented))
    random.shuffle(texts)

    dataset=LMDataset(texts,ByteTokenizer(),CONFIG.max_seq_len)
    if len(dataset)<20:
        raise RuntimeError("AgriConnect LLM corpus is too small to train.")

    loader=DataLoader(dataset,batch_size=args.batch_size,shuffle=True)
    model=AgriConnectLLM(CONFIG).to(device)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=0.01)

    print(f"Training AgriConnectLLM from random initialization on {device}")
    print(f"Examples: {len(dataset):,}")
    print(f"Parameters: {sum(p.numel() for p in model.parameters())/1e6:.2f}M")

    for epoch in range(args.epochs):
        model.train()
        total=0.0
        for x,y in loader:
            x,y=x.to(device),y.to(device)
            optimizer.zero_grad(set_to_none=True)
            _,loss=model(x,y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(),1.0)
            optimizer.step()
            total += float(loss.item())
        print(f"epoch {epoch+1}/{args.epochs} loss={total/max(1,len(loader)):.4f}")

    out=Path(CONFIG.model_path)
    if not out.is_absolute():
        out=backend_root/out
    out.parent.mkdir(parents=True,exist_ok=True)
    torch.save({
        "model":model.state_dict(),
        "config":CONFIG.__dict__,
        "training":{
            "examples":len(dataset),
            "epochs":args.epochs,
            "random_init":True,
            "repository_corpus":True,
        },
    },out)
    print(f"Saved: {out}")

if __name__=="__main__":
    main()
