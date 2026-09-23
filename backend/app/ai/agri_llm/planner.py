"""Inference wrapper for the locally trained AgriConnect LLM."""
import json,logging,os
from pathlib import Path
from typing import Optional,Dict,Any,List
import torch
from .config import CONFIG
from .model import AgriConnectLLM
from .tokenizer import ByteTokenizer

logger=logging.getLogger(__name__)

class AgriConnectLLMPlanner:
    def __init__(self):
        self.tokenizer=ByteTokenizer()
        self.model=None
        self.device=torch.device("cuda" if torch.cuda.is_available() and os.getenv("AGRICONNECT_LLM_DEVICE","auto")!="cpu" else "cpu")
        self.loaded=False
    def _path(self):
        p=Path(CONFIG.model_path)
        return p if p.is_absolute() else Path(__file__).resolve().parents[4]/p
    def load(self):
        if self.loaded: return True
        p=self._path()
        if not p.exists():
            logger.warning("AgriConnect LLM checkpoint not found: %s. Train it first.",p)
            return False
        try:
            ckpt=torch.load(p,map_location=self.device,weights_only=False)
            from .config import LLMConfig
            cfg_data=ckpt.get("config",{})
            cfg=LLMConfig(**{k:cfg_data[k] for k in LLMConfig.__dataclass_fields__ if k in cfg_data})
            self.model=AgriConnectLLM(cfg).to(self.device)
            self.model.load_state_dict(ckpt["model"])
            self.model.eval()
            self.loaded=True
            return True
        except Exception:
            logger.exception("Failed to load AgriConnect LLM")
            return False
    @staticmethod
    def _extract_json(text):
        start=text.find("{"); end=text.rfind("}")
        if start<0 or end<=start: return None
        try:
            obj=json.loads(text[start:end+1])
            return obj if isinstance(obj,dict) and isinstance(obj.get("requests"),list) else None
        except json.JSONDecodeError: return None
    async def plan(self,message,conversation=None):
        if not self.load(): return None
        history=[]
        for item in (conversation or [])[-4:]:
            if item.get("role") in {"user","assistant"}:
                history.append(f"{str(item.get('role')).upper()}: {str(item.get('content',''))[:600]}")
        prompt=("You are the AgriConnect website assistant. Understand simple, broken, misspelled and conversational English. "
                "Return only JSON with a requests array. Intents are product_search, cheapest_product, demand_forecast, navigate, project_information, general. "
                "Never invent prices, IDs or private information. For cheap/cheapest/lowest price plus a product, select that product only. "
                "For opening a product page set open=true.\n"+("\n".join(history)+"\n" if history else "")+
                f"USER: {message[:1000]}\nASSISTANT:")
        ids=self.tokenizer.encode_prompt(prompt)
        ids=ids[-self.model.cfg.max_seq_len:]
        x=torch.tensor([ids],dtype=torch.long,device=self.device)
        out=self.model.generate(x,max_new_tokens=180,temperature=0.15,top_k=12)
        generated=self.tokenizer.decode(out[0].tolist()[len(x[0]):])
        return self._extract_json(generated)

agri_llm_planner=AgriConnectLLMPlanner()
