"""Decoder-only Transformer built from PyTorch primitives. Weights start random."""
import math
import torch
from torch import nn
import torch.nn.functional as F
from .config import LLMConfig

class RMSNorm(nn.Module):
    def __init__(self, dim, eps=1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))
        self.eps = eps
    def forward(self, x):
        return self.weight * (x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps))

class CausalSelfAttention(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        assert cfg.d_model % cfg.n_heads == 0
        self.n_heads = cfg.n_heads
        self.head_dim = cfg.d_model // cfg.n_heads
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model, bias=False)
        self.out = nn.Linear(cfg.d_model, cfg.d_model, bias=False)
        self.dropout = nn.Dropout(cfg.dropout)
    def forward(self, x):
        b,t,c=x.shape
        q,k,v=self.qkv(x).chunk(3,dim=-1)
        q=q.view(b,t,self.n_heads,self.head_dim).transpose(1,2)
        k=k.view(b,t,self.n_heads,self.head_dim).transpose(1,2)
        v=v.view(b,t,self.n_heads,self.head_dim).transpose(1,2)
        scores=(q @ k.transpose(-2,-1))/math.sqrt(self.head_dim)
        mask=torch.triu(torch.ones(t,t,device=x.device,dtype=torch.bool),diagonal=1)
        scores=scores.masked_fill(mask,torch.finfo(scores.dtype).min)
        y=self.dropout(F.softmax(scores,dim=-1) @ v)
        return self.out(y.transpose(1,2).contiguous().view(b,t,c))

class FeedForward(nn.Module):
    def __init__(self,cfg):
        super().__init__()
        h=4*cfg.d_model
        self.net=nn.Sequential(nn.Linear(cfg.d_model,h),nn.GELU(),nn.Linear(h,cfg.d_model),nn.Dropout(cfg.dropout))
    def forward(self,x): return self.net(x)

class TransformerBlock(nn.Module):
    def __init__(self,cfg):
        super().__init__()
        self.norm1=RMSNorm(cfg.d_model)
        self.attn=CausalSelfAttention(cfg)
        self.norm2=RMSNorm(cfg.d_model)
        self.ffn=FeedForward(cfg)
    def forward(self,x):
        x=x+self.attn(self.norm1(x))
        return x+self.ffn(self.norm2(x))

class AgriConnectLLM(nn.Module):
    def __init__(self,cfg):
        super().__init__()
        self.cfg=cfg
        self.token_embedding=nn.Embedding(cfg.vocab_size,cfg.d_model)
        self.position_embedding=nn.Embedding(cfg.max_seq_len,cfg.d_model)
        self.blocks=nn.ModuleList([TransformerBlock(cfg) for _ in range(cfg.n_layers)])
        self.norm=RMSNorm(cfg.d_model)
        self.lm_head=nn.Linear(cfg.d_model,cfg.vocab_size,bias=False)
        self.lm_head.weight=self.token_embedding.weight
        self.apply(self._init_weights)
    @staticmethod
    def _init_weights(m):
        if isinstance(m,nn.Linear):
            nn.init.normal_(m.weight,0.0,0.02)
            if m.bias is not None: nn.init.zeros_(m.bias)
        elif isinstance(m,nn.Embedding):
            nn.init.normal_(m.weight,0.0,0.02)
    def forward(self,input_ids,targets=None):
        b,t=input_ids.shape
        if t>self.cfg.max_seq_len: raise ValueError(f"Sequence length {t} exceeds {self.cfg.max_seq_len}")
        pos=torch.arange(t,device=input_ids.device)
        x=self.token_embedding(input_ids)+self.position_embedding(pos)[None,:,:]
        for block in self.blocks: x=block(x)
        logits=self.lm_head(self.norm(x))
        loss=None
        if targets is not None:
            loss=F.cross_entropy(logits.reshape(-1,logits.size(-1)),targets.reshape(-1),ignore_index=-100)
        return logits,loss
    @torch.no_grad()
    def generate(self,input_ids,max_new_tokens=160,temperature=0.25,top_k=20,eos_id=257):
        self.eval()
        for _ in range(max_new_tokens):
            idx=input_ids[:,-self.cfg.max_seq_len:]
            logits,_=self(idx)
            logits=logits[:,-1,:]/max(temperature,1e-4)
            if top_k:
                values,_=torch.topk(logits,min(top_k,logits.size(-1)))
                logits[logits<values[:,[-1]]]=float("-inf")
            next_id=torch.multinomial(F.softmax(logits,dim=-1),1)
            input_ids=torch.cat([input_ids,next_id],dim=1)
            if int(next_id.item())==eos_id: break
        return input_ids
