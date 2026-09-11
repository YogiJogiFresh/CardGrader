# Model card

## Identity

- Model version:
- Preprocessing version:
- Grading profile version:
- Compatible app versions:

## Intended use

Estimate visible Pokémon card condition from the required six-view capture
protocol. Output must be presented as an unofficial grade range with
uncertainty, not authentication or a guaranteed professional grade.

## Training data

- Sources and licenses:
- Consent/provenance records:
- Physical-card count:
- Image count by view, card era, language, finish, grader, and grade:
- Exclusions and known coverage gaps:

## Evaluation

- Split method (must group by physical card and contributor):
- Sequestered test-set details:
- Identification top-1/top-k accuracy:
- Defect precision/recall and localization:
- Grade MAE and quadratic weighted kappa by grader:
- Prediction-range coverage and mean width:
- Out-of-distribution detection:
- Device latency, memory, battery, and thermal results:

## Limitations

- Defects that cannot be assessed reliably:
- Unsupported cards, finishes, languages, or capture conditions:
- Known demographic, device, contributor, and grading-era biases:
- Calibration limitations:

## Safety and release

- Privacy review:
- Dataset rights review:
- Model compatibility checks:
- Rollback version:
