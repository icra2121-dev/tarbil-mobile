begin;

-- Etiket, GPS konumlu fotoğrafın Ek-8 krokisinde hangi sera köşesine ait olduğunu belirtir.
alter table public.task_evidence
  add column if not exists corner_label text;

comment on column public.task_evidence.corner_label is
  'Ek-8 sera köşe etiketi: a-h. Fotoğrafın GPS koordinatları bu etikete göre rapora aktarılır.';

commit;
