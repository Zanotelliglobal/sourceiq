## API Coverage Decision

No external API integration in this phase. Phase 4 (Supplier Star Ratings)
only adds a DB column (`suppliers.identity_id`), an internal API route action
(`set_rating` on the existing `app/api/qualify/route.ts`), and a UI control.
No third-party service, SDK, or webhook is introduced — nothing to document
here beyond this one-liner.
