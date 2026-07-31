begin;

alter table public.cbs_units
  add column if not exists source_accuracy text;

create index if not exists cbs_units_public_parcel_lookup_idx
  on public.cbs_units(city, district, village, ada_no, parcel_no);

comment on column public.cbs_units.source is
  'Geometry origin. tkgm_public_approx is the public Parsel Sorgu geometry with reduced location accuracy.';

comment on column public.cbs_units.source_accuracy is
  'Accuracy class supplied by the source integration; public_reduced_precision is not survey-grade cadastral geometry.';

commit;
