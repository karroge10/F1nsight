# F1 Analytics - Image Assets

This directory contains organized image assets for the F1 Analytics application.

## Folder Structure

### 📍 `/tracks/`
Circuit and track images for race backgrounds and displays.

**Naming Convention:**
- Use circuit location name in lowercase with hyphens
- Format: `{location}.jpg` or `{location}.png`

**Examples:**
- `monaco.jpg` - Monaco Grand Prix circuit
- `silverstone.jpg` - British Grand Prix circuit
- `spa-francorchamps.jpg` - Belgian Grand Prix circuit
- `monza.jpg` - Italian Grand Prix circuit
- `suzuka.jpg` - Japanese Grand Prix circuit

### 🏎️ `/teams/`
Team logos, car images, and team-related assets.

**Naming Convention:**
- Use team name in lowercase with hyphens
- Format: `{team-name}-{type}.{ext}`

**Examples:**
- `red-bull-racing-logo.png`
- `ferrari-logo.png`
- `mercedes-logo.png`
- `mclaren-car.jpg`

### 👤 `/drivers/`
Driver portraits, headshots, and driver-related images.

**Naming Convention:**
- Use driver's full name with underscores
- Format: `{firstname}_{lastname}.jpg`

**Examples:**
- `max_verstappen.jpg` ✅ **Available**
- `lewis_hamilton.jpg`
- `charles_leclerc.jpg` 
- `lando_norris.jpg`

**Format Support:**
- **AVIF** (preferred) - Modern format with excellent compression
- **JPG** (fallback) - Traditional format
- **PNG** (for transparency needs)

### 🏢 `/principals/`
Team principals, managers, and key personnel photos.

**Naming Convention:**
- Use person's last name in lowercase
- Format: `{lastname}-{firstname}.jpg`

**Examples:**
- `horner-christian.jpg`
- `wolff-toto.jpg`
- `vasseur-frederic.jpg`

## Image Requirements

### Technical Specifications
- **Format**: 
  - **AVIF** (preferred) - Best compression, modern browsers
  - **JPG** for photos, **PNG** for logos/graphics with transparency
- **Resolution**: 
  - Track backgrounds: Minimum 1920x1080
  - Driver portraits: 400x400 minimum
  - Team logos: 200x200 minimum
- **Size**: Optimize for web (compress to <500KB when possible)
- **Quality**: High quality but web-optimized

### Track Images Specific Requirements
- **Aspect Ratio**: 16:9 preferred for race countdown backgrounds
- **Composition**: Aerial or wide shots work best
- **Style**: High contrast, vibrant colors to work well with overlaid text

## Usage in Components

### Race Countdown Background
Track images are automatically loaded based on circuit location:

```typescript
// Component will look for: /images/tracks/{location}.jpg
const backgroundImage = `/images/tracks/${circuit.toLowerCase().replace(/\s+/g, '-')}.jpg`;
```

### Dynamic Image Loading
Images are loaded with fallbacks to ensure the app works even if specific images are missing.

## Contributing Images

1. **Name files according to conventions above**
2. **Optimize images for web** (use tools like TinyPNG)
3. **Ensure proper licensing** (use royalty-free or own images)
4. **Test in dark/light themes** to ensure good contrast

## Notes

- All images should be web-optimized
- Consider providing both light and dark variants for logos if needed
- Use consistent aspect ratios within each category
- Images are served from the public directory and cached by browsers
