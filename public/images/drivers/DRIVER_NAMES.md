# Driver Image Naming Reference

This file shows how driver names are converted to image filenames.

## Current F1 Grid (2025)

| Driver Name | Image Filename | Status |
|-------------|----------------|---------|
| Max Verstappen | `max_verstappen.avif` | ✅ **Available** |
| Sergio Perez | `sergio_perez.avif` | Using max_verstappen.avif placeholder |
| Lewis Hamilton | `lewis_hamilton.avif` | Using max_verstappen.avif placeholder |
| George Russell | `george_russell.avif` | Using max_verstappen.avif placeholder |
| Charles Leclerc | `charles_leclerc.avif` | Using max_verstappen.avif placeholder |
| Carlos Sainz | `carlos_sainz.avif` | Using max_verstappen.avif placeholder |
| Lando Norris | `lando_norris.avif` | Using max_verstappen.avif placeholder |
| Oscar Piastri | `oscar_piastri.avif` | Using max_verstappen.avif placeholder |
| Fernando Alonso | `fernando_alonso.avif` | Using max_verstappen.avif placeholder |
| Lance Stroll | `lance_stroll.avif` | Using max_verstappen.avif placeholder |
| Nico Hulkenberg | `nico_hulkenberg.avif` | Using max_verstappen.avif placeholder |
| Kevin Magnussen | `kevin_magnussen.avif` | Using max_verstappen.avif placeholder |
| Pierre Gasly | `pierre_gasly.avif` | Using max_verstappen.avif placeholder |
| Esteban Ocon | `esteban_ocon.avif` | Using max_verstappen.avif placeholder |
| Alexander Albon | `alexander_albon.avif` | Using max_verstappen.avif placeholder |
| Logan Sargeant | `logan_sargeant.avif` | Using max_verstappen.avif placeholder |
| Yuki Tsunoda | `yuki_tsunoda.avif` | Using max_verstappen.avif placeholder |
| Daniel Ricciardo | `daniel_ricciardo.avif` | Using max_verstappen.avif placeholder |
| Valtteri Bottas | `valtteri_bottas.avif` | Using max_verstappen.avif placeholder |
| Zhou Guanyu | `zhou_guanyu.avif` | Using max_verstappen.avif placeholder |

## Name Conversion Rules

The system automatically converts driver names using these rules:

1. Convert to lowercase
2. Replace spaces with underscores
3. Remove special characters (except underscores)
4. Remove multiple/leading/trailing underscores

## Examples

- "Max Verstappen" → `max_verstappen.avif`
- "Lewis Hamilton" → `lewis_hamilton.avif`
- "Charles Leclerc" → `charles_leclerc.avif`
- "Fernando Alonso" → `fernando_alonso.avif`

## Current Fallback Chain

1. Try specific driver image (e.g., `lewis_hamilton.avif`)
2. If not found, use `max_verstappen.avif` as placeholder
3. If max_verstappen.avif not found, use `/placeholder-user.jpg` as final fallback

## Format Benefits

**AVIF Format Advantages:**
- ✅ 50% smaller file size than JPEG
- ✅ Better quality at smaller sizes
- ✅ Supports transparency
- ✅ Modern browsers support (Chrome, Firefox, Safari)
- ✅ Progressive loading

**Browser Support:**
- Chrome 85+
- Firefox 93+  
- Safari 16+
- Edge 121+

## Adding New Images

Simply upload driver images with the correct filename to this directory. The system will automatically use them instead of the max_verstappen.avif placeholder.

This file shows how driver names are converted to image filenames.

## Current F1 Grid (2025)

| Driver Name | Image Filename | Status |
|-------------|----------------|---------|
| Max Verstappen | `max_verstappen.avif` | ✅ **Available** |
| Sergio Perez | `sergio_perez.avif` | Using max_verstappen.avif placeholder |
| Lewis Hamilton | `lewis_hamilton.avif` | Using max_verstappen.avif placeholder |
| George Russell | `george_russell.avif` | Using max_verstappen.avif placeholder |
| Charles Leclerc | `charles_leclerc.avif` | Using max_verstappen.avif placeholder |
| Carlos Sainz | `carlos_sainz.avif` | Using max_verstappen.avif placeholder |
| Lando Norris | `lando_norris.avif` | Using max_verstappen.avif placeholder |
| Oscar Piastri | `oscar_piastri.avif` | Using max_verstappen.avif placeholder |
| Fernando Alonso | `fernando_alonso.avif` | Using max_verstappen.avif placeholder |
| Lance Stroll | `lance_stroll.avif` | Using max_verstappen.avif placeholder |
| Nico Hulkenberg | `nico_hulkenberg.avif` | Using max_verstappen.avif placeholder |
| Kevin Magnussen | `kevin_magnussen.avif` | Using max_verstappen.avif placeholder |
| Pierre Gasly | `pierre_gasly.avif` | Using max_verstappen.avif placeholder |
| Esteban Ocon | `esteban_ocon.avif` | Using max_verstappen.avif placeholder |
| Alexander Albon | `alexander_albon.avif` | Using max_verstappen.avif placeholder |
| Logan Sargeant | `logan_sargeant.avif` | Using max_verstappen.avif placeholder |
| Yuki Tsunoda | `yuki_tsunoda.avif` | Using max_verstappen.avif placeholder |
| Daniel Ricciardo | `daniel_ricciardo.avif` | Using max_verstappen.avif placeholder |
| Valtteri Bottas | `valtteri_bottas.avif` | Using max_verstappen.avif placeholder |
| Zhou Guanyu | `zhou_guanyu.avif` | Using max_verstappen.avif placeholder |

## Name Conversion Rules

The system automatically converts driver names using these rules:

1. Convert to lowercase
2. Replace spaces with underscores
3. Remove special characters (except underscores)
4. Remove multiple/leading/trailing underscores

## Examples

- "Max Verstappen" → `max_verstappen.avif`
- "Lewis Hamilton" → `lewis_hamilton.avif`
- "Charles Leclerc" → `charles_leclerc.avif`
- "Fernando Alonso" → `fernando_alonso.avif`

## Current Fallback Chain

1. Try specific driver image (e.g., `lewis_hamilton.avif`)
2. If not found, use `max_verstappen.avif` as placeholder
3. If max_verstappen.avif not found, use `/placeholder-user.jpg` as final fallback

## Format Benefits

**AVIF Format Advantages:**
- ✅ 50% smaller file size than JPEG
- ✅ Better quality at smaller sizes
- ✅ Supports transparency
- ✅ Modern browsers support (Chrome, Firefox, Safari)
- ✅ Progressive loading

**Browser Support:**
- Chrome 85+
- Firefox 93+  
- Safari 16+
- Edge 121+

## Adding New Images

Simply upload driver images with the correct filename to this directory. The system will automatically use them instead of the max_verstappen.avif placeholder.
