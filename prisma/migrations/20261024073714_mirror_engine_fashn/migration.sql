-- Jeff, 24 Oct 2026: "No current new photo" → the mirror dresses with FASHN (Google wants a photo in a fitted tee and pants).
-- Only a rule still at its old default moves; a value an admin set stays.
UPDATE "Rule" SET "value" = 'fashn' WHERE "key" = 'mirrorEngine' AND "value" = 'google';
