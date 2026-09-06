# Card Evaluator setup

The Card Evaluator sends compressed front/back card photos from the authenticated page to `netlify/functions/evaluate-card.js`. The function verifies the Firebase ID token and calls the OpenAI API from the server. Photos and API credentials are never written into the repository.

## Required Netlify environment variable

Add this in **Netlify → Site configuration → Environment variables**:

- `OPENAI_API_KEY`: an OpenAI project API key with API billing enabled.

Optional:

- `OPENAI_VISION_MODEL`: overrides the default vision-capable model (`gpt-5-mini`).

Never paste the API key into `card-evaluator.html`, GitHub, or a public support message.

After adding or changing an environment variable, redeploy the site so the function receives it.

## Current behavior

- Requires one front and one back photo.
- Accepts JPG, PNG, and WebP and compresses photos before upload.
- Returns a conservative PSA score estimate, range, confidence, photo quality, centering, corners, edges, surface, visible defects, and limitations.
- Returns no score when the photos are insufficient.
- Saves only the structured evaluation to `users/{uid}/cardEvaluations` when the member selects **Save Evaluation**. The submitted photos are not stored by Card Crate Club.
- The result is a photo-based estimate, not authentication or an official PSA grade.
