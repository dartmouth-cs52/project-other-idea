-- The widget's default is now black and white ("auto"). Sites still on the
-- old default blue switch over; sites that picked their own color keep it.
update public.sites
set appearance = jsonb_set(appearance, '{accent}', '"auto"')
where appearance->>'accent' = '#2f5bea';
