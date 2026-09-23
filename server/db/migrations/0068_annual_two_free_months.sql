-- La modalidad anual incluye dos meses sin costo: se cobran 10 mensualidades.
UPDATE subscription_plans SET annual_price_cents = 699000, updated_at = now() WHERE code = 'inicio';
UPDATE subscription_plans SET annual_price_cents = 1499000, updated_at = now() WHERE code = 'crecimiento';
UPDATE subscription_plans SET annual_price_cents = 3499000, updated_at = now() WHERE code = 'escala';
