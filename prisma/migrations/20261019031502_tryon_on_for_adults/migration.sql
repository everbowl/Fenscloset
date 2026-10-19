-- Try-on is on by default from now on (Jeff, 19 Oct 2026: "no limitations or controls"); adults who joined
-- before this get the same, and can still switch it off in Settings. Minors stay off (role gate).
UPDATE "Person" SET "tryOnEnabled" = true WHERE "role" <> 'minor';
