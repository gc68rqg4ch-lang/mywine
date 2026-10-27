-- Bot (service_role) ruft open_bottle auf; die Funktion prüft private.is_member()
-- und brauchte dafür Zugriff auf das Schema private.
grant usage on schema private to service_role;
