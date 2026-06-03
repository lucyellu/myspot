# AI Service Landscape (April 2026)

> Verified pricing and quality reality. Updated when models change. See [STATE.md](./STATE.md) for what's wired in code right now.

## TL;DR — recommended free defaults

| Step | Pick | Why |
| --- | --- | --- |
| Prompt enhance | **Gemini 2.5 Flash** (250/day free) → **Groq/Cerebras** (fast keyed fallback) → **DeepSeek V3** (cheap paid fallback) | free covers most days; fast providers light up when configured; DeepSeek is $0.0005/call when free runs out |
| Image gen | **Pollinations FLUX** (unlimited free) | no key, no quota, FLUX.dev quality |
| Image gen (premium) | **HuggingFace FLUX-schnell** | 30/mo free on personal account, ~Midjourney v7 tier |
| Image inspiration (vision) | **Gemini 2.5 Flash + auto-fallback** | free 250/day per model, falls through to lite/2.0 on 503 |
| Image-to-video (auto) | **HF LTX-Video** | ~3-60/mo free, mid quality |
| Image-to-video (best) | **Kling web manual paste** | 6/day free, no API, highest quality |

The 🚀 Auto button uses these defaults automatically.

## Detailed comparisons

### Text models (prompt enhancement)

| Model | Cost per call | Free tier | Quality | Setup |
| --- | --- | --- | --- | --- |
| **Gemini 2.5 Flash** | ~$0.0008 | **250 RPD/free** | very good | GEMINI_API_KEY |
| Gemini 2.0 Flash | ~$0.0002 | 1500 RPD free | good | (auto-fallback) |
| **Groq Llama 3.3 70B** | varies | account-dependent | very good, very fast | GROQ_API_KEY |
| **Cerebras GPT OSS 120B** | varies | account-dependent | good, very fast | CEREBRAS_API_KEY |
| **DeepSeek V3** | ~$0.0005 | none, $5 ≈ 10k calls | very good (creative prose) | DEEPSEEK_API_KEY |
| DeepSeek Reasoner | ~$0.002 | none | very good (reasoning) | (not wired — overkill for this) |
| Claude Sonnet 4.6 | ~$0.005 | none | premium | ANTHROPIC_API_KEY |
| Claude Opus 4.7 | ~$0.025 | none | premium | (not wired — too pricey) |

### Image models

| Model | Cost per image | Free tier | Quality vs MJ v7 | API |
| --- | --- | --- | --- | --- |
| **Pollinations FLUX.dev** | $0 | unlimited | ~95% | yes, no key |
| **Pollinations FLUX-Realism** | $0 | unlimited | ~95% photoreal | yes |
| Pollinations FLUX-Anime | $0 | unlimited | very good | yes |
| Pollinations FLUX-Turbo | $0 | unlimited | draft quality | yes |
| **HF FLUX.1-schnell** | ~$0.003 | ~30/mo free, 600/mo on Pro | ~98% | yes, HF_TOKEN |
| HF FLUX.1-dev | ~$0.012 | ~10/mo free | ~99% | yes |
| HF FLUX.1.1-pro | ~$0.04 | none | ~Midjourney v7 | yes |
| Gemini Nano Banana | ~$0.04 | none on new projects | ~85% | yes, GEMINI_API_KEY |
| Grok Imagine | $0.02 | gone since March 2026 | ~FLUX.dev | yes, XAI_API_KEY |
| **OpenAI gpt-image-1 (low)** | ~$0.02 | none | ~85% | yes (paid) |
| **OpenAI gpt-image-1 (medium)** | ~$0.04 | none | ~Nano Banana | yes |
| **OpenAI gpt-image-1 (high)** | ~$0.17 | none | ~MJ v6+ | yes |
| OpenAI DALL-E 3 standard | $0.04 | none | ~Nano Banana | yes |
| OpenAI DALL-E 3 HD | $0.08 | none | better than DALL-E 3 standard | yes |
| Midjourney v7 | $10/mo (relaxed unlimited) | none | reference | no public API |
| Cloudflare Workers AI | ~$0.002 | ~60/day free (FLUX-schnell) | ~95% | not yet wired |

**Quality notes:**
- **Pollinations FLUX = Midjourney v6-tier** for most prompts; matches MJ on prompt-adherence and realism, slightly behind on "default beauty."
- **FLUX hates wide aspect ratios with full-body figures.** Use 1024×1024 (current default) and let myspot's player letterbox.
- **FLUX-Realism wins for photoreal** subjects; **FLUX.dev wins for atmospheric/painterly**; **FLUX-Anime for stylized**.
- **DeepSeek-V3 enhanced prompts often beat raw Midjourney prompts** — the prose density compensates for FLUX's literalism.

### Vision (image-to-prompt)

| Model | Cost | Free | Notes |
| --- | --- | --- | --- |
| Gemini 2.5 Flash | $0.001/call | 250 RPD | wired, primary |
| Gemini 2.5 Flash Lite | $0.0003/call | 1000 RPD | wired, fallback |
| Gemini 2.0 Flash | $0.0002/call | 1500 RPD | wired, last resort |
| Claude Sonnet vision | $0.003/call | none | not wired |

myspot's `inspire` chains through all three Gemini models on 503/429 — free tier almost always works.

### Image-to-video models

| Model | Cost / clip | Free tier | Quality | API? |
| --- | --- | --- | --- | --- |
| **Kling 2.0 (subscription)** | **$9.99/mo for 1000 credits** (~100 short clips at 10cr each, ~50 at 20cr for 10s) | 6/day on web | best | **enterprise only**, no public pay-as-go API |
| Kling Premier | $35/mo for 4000 credits | — | best | enterprise only |
| **Veo 3.1** | ~$0.35/sec ≈ $2/clip | **none** | best (with audio) | yes via Vertex |
| **Pika 2.0** | $7/mo entry tier | trial credits only | very good | paid |
| **Hailuo MiniMax I2V-01** | ~$0.43/clip | $10 trial credit on signup | very good | yes via minimaxi.com |
| **Runway Gen-4** | $$ | ~125 free credits/mo | very good | yes |
| **HF LTX-Video** | ~$0.05/clip | ~3-60/mo free | mid | yes via HF Inference |
| **HF CogVideoX-5b** | ~$0.05/clip | ~3-60/mo free | mid | yes |
| **HF Mochi-1** | ~$0.05/clip | ~3-60/mo free | mid-good | yes |
| **HF Wan2.2** | ~$0.10/clip | ~3-30/mo free | good | yes |
| **Seedance / Doubao** | free in Doubao | China-only | very good | requires Chinese phone |

**Reality:** there is **no free unlimited video API** equivalent of Pollinations. Two free-ish paths:
- **Automated:** HF LTX/CogVideoX/Mochi via `Animate` button on track clips. Limited monthly budget.
- **Manual:** Kling web at 6/day. myspot's `K` button on each clip downloads the image and opens kling.ai — paste the resulting MP4 back onto the player canvas to attach.

### Music generation (for concert mode regen)

| Service | Cost | Free tier | API |
| --- | --- | --- | --- |
| **Suno** | $10/mo Pro | 500 credits/day on free tier | unofficial only (cookie auth) |
| Udio | $10/mo standard | trial credits | unofficial only |
| Stable Audio | enterprise only | none | yes |
| MusicGen (Meta) | open weights | self-host | huggingface |

myspot doesn't generate music yet — SunoSync downloads what the user generates manually. M6 concert mode would wire Suno cookie regen.

## API key portals

| Service | Where | Notes |
| --- | --- | --- |
| Google Gemini | https://aistudio.google.com/apikey | Click project → "Set up billing" needed for Nano Banana |
| Groq | https://console.groq.com/keys | Uses OpenAI-compatible chat completions |
| Cerebras | https://cloud.cerebras.ai/ | Uses OpenAI-compatible chat completions |
| DeepSeek | https://platform.deepseek.com/api_keys | Top up at /usage/balance ($5 minimum) |
| Anthropic | https://console.anthropic.com/settings/keys | Pay-as-you-go |
| xAI | https://console.x.ai/ | "API Keys" left nav |
| HuggingFace | https://huggingface.co/settings/tokens | Read scope is enough |
| Cloudflare Workers AI | https://dash.cloudflare.com/profile/api-tokens | Account ID also needed (not yet wired) |
| Pollinations | none — no auth | wide-open |

## Setup recipes

### Minimal free setup (Pollinations only)
- Just run myspot. Pollinations is the default. No keys needed.
- 🚀 Auto button without any keys generates 4 free FLUX images per song using a fallback prompt builder.

### Recommended free+cheap setup
1. `GEMINI_API_KEY` from AI Studio (free)
2. Optional `GROQ_API_KEY` or `CEREBRAS_API_KEY` for fast prompt enhancement fallbacks
3. `DEEPSEEK_API_KEY` with $5 deposit
4. (Pollinations active by default)
5. → 🚀 Auto: Gemini enhances prompt → Pollinations generates 4 images. Total cost: $0.

### Premium quality setup
1. Above three, plus:
2. `HF_TOKEN` from HuggingFace ($9/mo Pro for ~600 FLUX-schnell + 60 LTX-Video clips)
3. Optional `ANTHROPIC_API_KEY` for Claude on hero prompts
4. → 🚀 Auto routed through HF FLUX-schnell instead of Pollinations when picked manually
5. → Animate buttons on track clips work for I2V

### Best-quality video (manual)
1. Above setups, plus:
2. **Kling web account** (free, 6 clips/day at https://app.klingai.com/global/image-to-video)
3. Click `K` on any track clip → image auto-downloads + Kling opens → drag the resulting MP4 back onto myspot's player canvas

## Notes on automation ethics + ToS

- **Pollinations**: explicitly free for any use, including commercial.
- **HuggingFace Inference Providers**: paid usage covers the model creators; free tier is HF subsidizing exposure. Fair use.
- **Gemini / Claude / DeepSeek / xAI**: standard API terms; key issuer responsible.
- **Kling / Pika / Runway web manual**: each has their own ToS; manual user-driven use is fine, automated scraping isn't.
- **Meta AI / Grok web automation**: ToS gray. myspot doesn't ship this — Pollinations is a clean alternative.
- **Suno cookie regen** (concert mode M6): grayer. SunoSync established the precedent; revisit ethics when implementing.
