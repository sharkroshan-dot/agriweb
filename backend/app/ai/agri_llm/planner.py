"""Inference wrapper for the locally trained AgriConnect LLM."""
import json, logging, os
from pathlib import Path
from typing import Optional, Dict, Any, List
import torch
from .config import CONFIG
from .model import AgriConnectLLM
from .tokenizer import ByteTokenizer

logger=logging.getLogger(__name__)

class AgriConnectLLMPlanner:
    def __init__(self):
        self.tokenizer=ByteTokenizer()
        self.model=None
        self.device=torch.device(
            "cuda" if torch.cuda.is_available() and os.getenv("AGRICONNECT_LLM_DEVICE","auto")!="cpu" else "cpu"
        )
        self.loaded=False

    def _path(self):
        p=Path(CONFIG.model_path)
        return p if p.is_absolute() else Path(__file__).resolve().parents[3] / p

    def load(self):
        if self.loaded:
            return True
        p=self._path()
        if not p.exists():
            logger.warning("AgriConnect LLM checkpoint not found: %s. Run scripts/train_agriconnect_llm.py.",p)
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
            logger.info("Loaded AgriConnectLLM from %s on %s",p,self.device)
            return True
        except Exception:
            logger.exception("Failed to load AgriConnectLLM")
            return False

    @staticmethod
    def _extract_json(text: str) -> Optional[Dict[str,Any]]:
        start=text.find("{")
        if start<0:
            return None
        # Try every closing brace from the end backwards; generated text can
        # contain trailing natural language or an incomplete JSON fragment.
        for end in range(len(text)-1,start,-1):
            if text[end] != "}":
                continue
            try:
                obj=json.loads(text[start:end+1])
                if isinstance(obj,dict) and isinstance(obj.get("requests"),list):
                    return obj
            except json.JSONDecodeError:
                continue
        return None

    async def plan(self,message: str,conversation: Optional[List[Dict[str,Any]]]=None):
        if not self.load():
            return None
        history=[]
        for item in (conversation or [])[-4:]:
            if item.get("role") in {"user","assistant"}:
                history.append(f"{str(item.get('role')).upper()}: {str(item.get('content',''))[:500]}")
        prompt=(
            "You are the AgriConnect website assistant. Convert the user request to JSON only. "
            "Intents: product_search, cheapest_product, demand_forecast, navigate, project_information, general. "
            "JSON schema: {\\"requests\\":[{\\"intent\\":string,\\"query\\":string,\\"product\\":string,"
            "\\"days\\":7,\\"destination\\":string,\\"open\\":false}]}. "
            "Use the exact product mentioned. Cheap tomato means cheapest_product for tomato, never all products. "
            "Broken English and spelling mistakes should be understood. Never invent prices, IDs or forecasts. "
            "For a product page request set open=true.\n"
            + ("\n".join(history)+"\n" if history else "")
            + f"USER: {message[:900]}\nASSISTANT:"
        )
        ids=self.tokenizer.encode_prompt(prompt)
        # The model must retain the end of the prompt because that contains the user query.
        ids=ids[-self.model.cfg.max_seq_len:]
        x=torch.tensor([ids],dtype=torch.long,device=self.device)
        out=self.model.generate(x,max_new_tokens=220,temperature=0.08,top_k=8)
        generated=self.tokenizer.decode(out[0].tolist()[len(x[0]):])
        return self._extract_json(generated)

agri_llm_planner=AgriConnectLLMPlanner()
