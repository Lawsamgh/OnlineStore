-- MVP storefront theme settings (preset + optional color/font overrides).

alter table public.stores
add column if not exists theme_id text not null default 'default',
add column if not exists theme_primary_color text,
add column if not exists theme_accent_color text,
add column if not exists theme_bg_color text,
add column if not exists theme_surface_color text,
add column if not exists theme_text_color text,
add column if not exists theme_font_family text;
