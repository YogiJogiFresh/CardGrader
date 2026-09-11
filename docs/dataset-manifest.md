# Dataset manifest contract

Every image must belong to a stable physical-card record and capture session.
Raw images and private contributor information stay outside Git.

Required fields:

- `physical_card_id`
- `capture_session_id`
- `image_sha256`
- `view_id`
- `card_catalog_id` and identification confidence
- `grader`, final grade, grading date/era, and cert reference when lawful
- available subgrades
- device and lighting metadata
- defect annotations and obscured/unknown regions
- provenance category, license/consent reference, and revocation status

Train, validation, and test assignment must group by both physical card and
contributor. Near-duplicate images must be detected before splitting.
Unlicensed images and revoked contributions must be excluded and removable by
manifest reference.
