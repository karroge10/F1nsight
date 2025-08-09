# FastF1 Analytics API

This is the Python backend service that provides advanced F1 analytics using the FastF1 library.

## Features

- **WDC Calculator**: Mathematical analysis of who can still win the World Drivers Championship
- **Position Changes**: Track position changes throughout a race lap by lap
- **Lap Times Analysis**: Detailed lap time data with tyre compound information
- **Team Pace Comparison**: Compare qualifying vs race pace across teams

## Quick Start

### Windows
```bash
./start.bat
```

### Linux/Mac
```bash
chmod +x start.sh
./start.sh
```

### Manual Setup
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the API server
python main.py
```

## API Endpoints

- `GET /` - Health check
- `GET /wdc-calculator/{year}` - Championship possibilities analysis
- `GET /position-changes/{year}/{round}` - Position changes during race
- `GET /lap-times/{year}/{round}` - Lap time data for all drivers
- `GET /team-pace/{year}/{round}` - Team pace comparison

## Frontend Integration

The Next.js frontend automatically detects if the FastF1 API is running and uses real data when available. If the API is not running, it falls back to realistic mock data.

The API runs on `http://localhost:8000` by default and is configured with CORS to work with the Next.js frontend on `http://localhost:3000`.

## Data Source

This API uses the FastF1 Python library which provides access to Formula 1 timing data, telemetry, and race information from the official F1 live timing data.
