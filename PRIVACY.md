# Privacy Notice

This project processes school and professor-related information collected from third-party sources and user-provided inputs used for planning and analysis.

## What may be processed

- school names and ranking metadata
- professor names, ratings, and profile links
- generated study-plan prompts and outputs
- configuration values supplied through environment variables

## What this repository does not intend to do

- collect unnecessary personal information
- store secrets in source control
- retain user inputs longer than needed for the current session unless explicitly added by a future feature

## Operator responsibilities

If you deploy or extend this project, you are responsible for:
- telling users what data is collected and why
- documenting any persistence or retention policy
- ensuring third-party data usage complies with the source terms and applicable law
- providing a deletion path if you store user data

## Recommendation

Before shipping a public deployment, add a product-specific privacy policy that explains:
- exactly what data is stored
- where it is stored
- how long it is retained
- how users can request deletion
