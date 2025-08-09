# Track Image Naming Reference

This file shows how circuit names from the API are converted to image filenames.

## Current 2025 F1 Calendar

| Circuit Name (from API) | Image Filename | Status |
|------------------------|----------------|---------|
| Sakhir | `sakhir.jpg` | Using zandvoort.jpg placeholder |
| Jeddah | `jeddah.jpg` | Using zandvoort.jpg placeholder |
| Melbourne | `melbourne.jpg` | Using zandvoort.jpg placeholder |
| Suzuka | `suzuka.jpg` | Using zandvoort.jpg placeholder |
| Shanghai | `shanghai.jpg` | Using zandvoort.jpg placeholder |
| Miami | `miami.jpg` | Using zandvoort.jpg placeholder |
| Imola | `imola.jpg` | Using zandvoort.jpg placeholder |
| Monaco | `monaco.jpg` | Using zandvoort.jpg placeholder |
| Barcelona | `barcelona.jpg` | Using zandvoort.jpg placeholder |
| Montreal | `montreal.jpg` | Using zandvoort.jpg placeholder |
| Silverstone | `silverstone.jpg` | Using zandvoort.jpg placeholder |
| Hungaroring | `hungaroring.jpg` | Using zandvoort.jpg placeholder |
| Spa-Francorchamps | `spa-francorchamps.jpg` | Using zandvoort.jpg placeholder |
| Zandvoort | `zandvoort.jpg` | ✅ **Available** |
| Monza | `monza.jpg` | Using zandvoort.jpg placeholder |
| Baku | `baku.jpg` | Using zandvoort.jpg placeholder |
| Singapore | `singapore.jpg` | Using zandvoort.jpg placeholder |
| Austin | `austin.jpg` | Using zandvoort.jpg placeholder |
| Mexico City | `mexico-city.jpg` | Using zandvoort.jpg placeholder |
| São Paulo | `sao-paulo.jpg` | Using zandvoort.jpg placeholder |
| Las Vegas | `las-vegas.jpg` | Using zandvoort.jpg placeholder |
| Lusail | `lusail.jpg` | Using zandvoort.jpg placeholder |
| Yas Marina | `yas-marina.jpg` | Using zandvoort.jpg placeholder |

## Name Conversion Rules

The system automatically converts circuit names using these rules:

1. Convert to lowercase
2. Remove common words: "Circuit", "International", "Grand Prix", "de "
3. Replace spaces with hyphens
4. Remove leading/trailing hyphens

## Examples

- "Circuit de Monaco" → `monaco.jpg`
- "Silverstone Circuit" → `silverstone.jpg`
- "Yas Marina Circuit" → `yas-marina.jpg`
- "Circuit Gilles Villeneuve" → `gilles-villeneuve.jpg`

## Adding New Images

Simply upload images with the correct filename to this directory. The system will automatically use them instead of the zandvoort.jpg placeholder.

## Current Fallback Chain

1. Try specific track image (e.g., `monaco.jpg`)
2. If not found, use `zandvoort.jpg` as placeholder
3. If zandvoort.jpg not found, use `/f1-aerial.png` as final fallback

This file shows how circuit names from the API are converted to image filenames.

## Current 2025 F1 Calendar

| Circuit Name (from API) | Image Filename | Status |
|------------------------|----------------|---------|
| Sakhir | `sakhir.jpg` | Using zandvoort.jpg placeholder |
| Jeddah | `jeddah.jpg` | Using zandvoort.jpg placeholder |
| Melbourne | `melbourne.jpg` | Using zandvoort.jpg placeholder |
| Suzuka | `suzuka.jpg` | Using zandvoort.jpg placeholder |
| Shanghai | `shanghai.jpg` | Using zandvoort.jpg placeholder |
| Miami | `miami.jpg` | Using zandvoort.jpg placeholder |
| Imola | `imola.jpg` | Using zandvoort.jpg placeholder |
| Monaco | `monaco.jpg` | Using zandvoort.jpg placeholder |
| Barcelona | `barcelona.jpg` | Using zandvoort.jpg placeholder |
| Montreal | `montreal.jpg` | Using zandvoort.jpg placeholder |
| Silverstone | `silverstone.jpg` | Using zandvoort.jpg placeholder |
| Hungaroring | `hungaroring.jpg` | Using zandvoort.jpg placeholder |
| Spa-Francorchamps | `spa-francorchamps.jpg` | Using zandvoort.jpg placeholder |
| Zandvoort | `zandvoort.jpg` | ✅ **Available** |
| Monza | `monza.jpg` | Using zandvoort.jpg placeholder |
| Baku | `baku.jpg` | Using zandvoort.jpg placeholder |
| Singapore | `singapore.jpg` | Using zandvoort.jpg placeholder |
| Austin | `austin.jpg` | Using zandvoort.jpg placeholder |
| Mexico City | `mexico-city.jpg` | Using zandvoort.jpg placeholder |
| São Paulo | `sao-paulo.jpg` | Using zandvoort.jpg placeholder |
| Las Vegas | `las-vegas.jpg` | Using zandvoort.jpg placeholder |
| Lusail | `lusail.jpg` | Using zandvoort.jpg placeholder |
| Yas Marina | `yas-marina.jpg` | Using zandvoort.jpg placeholder |

## Name Conversion Rules

The system automatically converts circuit names using these rules:

1. Convert to lowercase
2. Remove common words: "Circuit", "International", "Grand Prix", "de "
3. Replace spaces with hyphens
4. Remove leading/trailing hyphens

## Examples

- "Circuit de Monaco" → `monaco.jpg`
- "Silverstone Circuit" → `silverstone.jpg`
- "Yas Marina Circuit" → `yas-marina.jpg`
- "Circuit Gilles Villeneuve" → `gilles-villeneuve.jpg`

## Adding New Images

Simply upload images with the correct filename to this directory. The system will automatically use them instead of the zandvoort.jpg placeholder.

## Current Fallback Chain

1. Try specific track image (e.g., `monaco.jpg`)
2. If not found, use `zandvoort.jpg` as placeholder
3. If zandvoort.jpg not found, use `/f1-aerial.png` as final fallback
