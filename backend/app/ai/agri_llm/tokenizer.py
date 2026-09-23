"""UTF-8 byte tokenizer implemented specifically for AgriConnect."""
BOS, EOS, PAD, UNK = 256, 257, 258, 259

class ByteTokenizer:
    vocab_size = 260
    pad_id = PAD
    eos_id = EOS
    def encode(self, text: str, add_bos: bool = True, add_eos: bool = True) -> list[int]:
        data = list((text or "").encode("utf-8", errors="replace"))
        ids = ([BOS] if add_bos else []) + data
        if add_eos:
            ids.append(EOS)
        return ids
    def decode(self, ids: list[int]) -> str:
        return bytes(i for i in ids if 0 <= i < 256).decode("utf-8", errors="replace")
    def encode_prompt(self, text: str) -> list[int]:
        return self.encode(text, add_bos=True, add_eos=False)
    def save(self, path: str) -> None:
        import json
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type":"utf8-byte","vocab_size":self.vocab_size}, f, indent=2)
    @classmethod
    def load(cls, path: str):
        return cls()
