const replacements: [RegExp, string][] = [
  [/Ãœ/g, "Ü"],
  [/Ã¼/g, "ü"],
  [/Ã–/g, "Ö"],
  [/Ã¶/g, "ö"],
  [/Ã‡/g, "Ç"],
  [/Ã§/g, "ç"],
  [/Ä°/g, "İ"],
  [/Ä±/g, "ı"],
  [/ÄŸ/g, "ğ"],
  [/Äž/g, "Ğ"],
  [/Ä/g, "Ğ"],
  [/ÅŸ/g, "ş"],
  [/Å/g, "Ş"],
  [/Åž/g, "Ş"],
  [/Â²/g, "²"],
  [/Â·/g, "·"],
  [/Â/g, ""],
];

const wordCorrections: [RegExp, string][] = [
  [/\bG\?rev/gi, "Görev"],
  [/\bG�rev/gi, "Görev"],
  [/\bg\?rev/gi, "görev"],
  [/\bg�rev/gi, "görev"],
  [/\bDenet\?im/gi, "Denetim"],
  [/\bDenet�im/gi, "Denetim"],
  [/\bdenet\?im/gi, "denetim"],
  [/\bdenet�im/gi, "denetim"],
  [/\bUretici\b/gi, "Üretici"],
  [/\buretim\b/gi, "üretim"],
  [/\bUretim\b/gi, "Üretim"],
  [/\bUrun\b/gi, "Ürün"],
  [/\burun\b/gi, "ürün"],
  [/\bUnite\b/gi, "Ünite"],
  [/\bunite\b/gi, "ünite"],
  [/\bIlce\b/gi, "İlçe"],
  [/\bilce\b/gi, "ilçe"],
  [/\bKOB\?KS\b/gi, "KOBÜKS"],
  [/\bKOB�KS\b/gi, "KOBÜKS"],
  [/\bKOBUKS\b/gi, "KOBÜKS"],
  [/\bKOB\?DS\b/gi, "KOBÜDS"],
  [/\bKOB�DS\b/gi, "KOBÜDS"],
  [/\bKOBUDS\b/gi, "KOBÜDS"],
  [/\bsifresi\b/gi, "şifresi"],
  [/\bSifresi\b/gi, "Şifresi"],
  [/\bSiniflandirma\b/gi, "Sınıflandırma"],
  [/\bsiniflandirma\b/gi, "sınıflandırma"],
  [/\bBa(?:\?|�)vurulu\b/gi, "Başvurulu"],
  [/\bba(?:\?|�)vurulu\b/gi, "başvurulu"],
  [/\bS(?:\?|�)n(?:\?|�)fland(?:\?|�)rma\b/gi, "Sınıflandırma"],
  [/\bs(?:\?|�)n(?:\?|�)fland(?:\?|�)rma\b/gi, "sınıflandırma"],
  [/\bDenet(?:\?|�)i\b/gi, "Denetçi"],
  [/\bdenet(?:\?|�)i\b/gi, "denetçi"],
  [/\bKay(?:\?|�)t\b/gi, "Kayıt"],
  [/\bkay(?:\?|�)t\b/gi, "kayıt"],
  [/(^|\s)(?:\?|�)retici\b/gi, "$1Üretici"],
  [/(^|\s)(?:\?|�)retim\b/gi, "$1Üretim"],
  [/(^|\s)(?:\?|�)r(?:\?|�)n\b/gi, "$1Ürün"],
  [/(^|\s)(?:\?|�)nite\b/gi, "$1Ünite"],
  [/(^|\s)(?:\?|�)l(?:\?|�)e\b/gi, "$1İlçe"],
  [/\bAtand(?:\?|�)(?=\s|$|[.,;:])/gi, "Atandı"],
  [/\bTamamland(?:\?|�)(?=\s|$|[.,;:])/gi, "Tamamlandı"],
  [/\bBa(?:\?|�)lad(?:\?|�)(?=\s|$|[.,;:])/gi, "Başladı"],
  [/\bolu(?:\?|�)turuldu\b/gi, "oluşturuldu"],
  [/\ba(?:\?|�)(?:\?|�)lamad(?:\?|�)\b/gi, "açılamadı"],
  [/\bse(?:\?|�)ildi\b/gi, "seçildi"],
  [/\bpoligon (?:\?|�)izilmeli\b/gi, "poligon çizilmeli"],
];

export function fixMojibake(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  let normalized = String(value);

  for (let index = 0; index < 3; index += 1) {
    const nextValue = replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), normalized);

    if (nextValue === normalized) {
      break;
    }

    normalized = nextValue;
  }

  return wordCorrections
    .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), normalized)
    .replace(/ï¿½/g, "")
    .replace(/�/g, "");
}

export function fixRecordText<T>(value: T): T {
  if (typeof value === "string") {
    return fixMojibake(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => fixRecordText(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, fixRecordText(nestedValue)]),
    ) as T;
  }

  return value;
}
