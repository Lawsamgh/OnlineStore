-- SMS destination for platform alerts to super admins (e.g. new seller joined).
-- Value is normalized in Edge Functions (local 0… → 233…). Can include + or spaces.
insert into public.platform_settings (key, value)
values ('super_admin_sms_phone_e164', '0594042786')
on conflict (key) do nothing;
