"""Train AgriConnectLLM from random initialization; no pretrained model is loaded."""
import argparse,random
from pathlib import Path
import torch
from torch.utils.data import Dataset,DataLoader
from app.ai.agri_llm.config import CONFIG
from app.ai.agri_llm.model import AgriConnectLLM
from app.ai.agri_llm.tokenizer import ByteTokenizer
from app.ai.agri_llm.training_data import build_training_texts

class LMDataset(Dataset):
    def __init__(self,texts,tokenizer,max_len):
        self.rows=[]
        for text in texts:
            ids=tokenizer.encode(text)[:max_len]
            x=ids[:-1]; y=ids[1:]
            pad=max_len-1-len(x)
            if pad>0:
                x += [tokenizer.pad_id]*pad
                y += [-100]*pad
            self.rows.append((torch.tensor(x,dtype=torch.long),torch.tensor(y,dtype=torch.long)))
    def __len__(self): return len(self.rows)
    def __getitem__(self,i): return self.rows[i]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--epochs",type=int,default=8)
    ap.add_argument("--batch-size",type=int,default=8)
    ap.add_argument("--lr",type=float,default=3e-4)
    ap.add_argument("--device",default="auto")
    args=ap.parse_args()
    random.seed(42); torch.manual_seed(42)
    device=torch.device("cuda" if args.device!="cpu" and torch.cuda.is_available() else "cpu")
    tokenizer=ByteTokenizer()
    texts=build_training_texts()
    augmented=list(texts)
    for text in texts:
        user,rest=text.split("\nASSISTANT:",1)
        phrase=user[6:]
        for v in [phrase.replace("tomato","tomatoo"),phrase.replace("tomato","tomatoe"),
                  phrase.replace("cheap","cheep"),phrase.replace("price","prce"),
                  phrase.replace("show","shw"),phrase.replace("product","prodct")]:
            if v!=phrase: augmented.append(f"USER: {v}\nASSISTANT:{rest}")
    random.shuffle(augmented)
    dataset=LMDataset(augmented,tokenizer,CONFIG.max_seq_len)
    loader=DataLoader(dataset,batch_size=args.batch_size,shuffle=True)
    model=AgriConnectLLM(CONFIG).to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=0.01)
    print(f"Training AgriConnectLLM from random initialization on {device}")
    print(f"Examples: {len(dataset):,}; parameters: {sum(p.numel() for p in model.parameters())/1e6:.2f}M")
    for epoch in range(args.epochs):
        model.train(); total=0.0
        for x,y in loader:
            x,y=x.to(device),y.to(device)
            opt.zero_grad(set_to_none=True)
            _,loss=model(x,y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(),1.0)
            opt.step(); total+=float(loss.item())
        print(f"epoch {epoch+1}/{args.epochs} loss={total/max(1,len(loader)):.4f}")
    out=Path(CONFIG.model_path)
    if not out.is_absolute(): out=Path(__file__).resolve().parents[1]/out
    out.parent.mkdir(parents=True,exist_ok=True)
    torch.save({"model":model.state_dict(),"config":CONFIG.__dict__,"training":{"examples":len(dataset),"epochs":args.epochs,"random_init":True}},out)
    print(f"Saved: {out}")

if __name__=="__main__": main()
