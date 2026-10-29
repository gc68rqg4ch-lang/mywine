-- Spirituosen: neue Art „spirit“ in wine_type (neben Rot, Weiss, Rosé, Schaumwein, Süsswein,
-- Likörwein). Eigene Datei – ein neuer Enum-Wert darf nicht in derselben Transaktion verwendet
-- werden (Kategorien, Felder und Views folgen in der nächsten Migration). „fortified“ (Port,
-- Sherry, Madeira) bleibt Wein.

alter type public.wine_type add value if not exists 'spirit';
