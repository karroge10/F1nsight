import { useState, useEffect } from 'react';
import { cachedFetch, f1Cache } from '@/lib/cache';

interface ScheduleRace {
  round_number: number;
  country: string;
  location: string;
  official_name: string;
  event_name: string;
  event_date: string;
  event_format: string;
  session5_date?: string;
}

interface ScheduleResponse {
  data: ScheduleRace[];
  source: string;
  success: boolean;
}

export function useF1Schedule(year: number = new Date().getFullYear()) {
  const [data, setData] = useState<ScheduleRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        setLoading(true);
        setError(null);

        // Use cached fetch with 24-hour cache duration
        const response = await cachedFetch<ScheduleResponse>(
          `/api/fastf1/schedule?year=${year}`,
          `schedule_${year}`,
          24 * 60 * 60 * 1000, // 24 hours
          { 
            next: { revalidate: 86400 } // Server-side cache as well
          }
        );

        if (response.success && response.data) {
          setData(response.data);
        } else {
          throw new Error('Invalid schedule data received');
        }
      } catch (err) {
        console.error('Failed to fetch F1 schedule:', err);
        setError(err instanceof Error ? err.message : 'Failed to load schedule');
        
        // Fallback data
        setData([
          {
            round_number: 1,
            country: "Bahrain",
            location: "Sakhir",
            official_name: "Formula 1 Gulf Air Bahrain Grand Prix 2025",
            event_name: "Bahrain Grand Prix",
            event_date: "2025-03-02T15:00:00",
            event_format: "conventional",
            session5_date: "2025-03-02T15:00:00"
          },
          {
            round_number: 2,
            country: "Saudi Arabia",
            location: "Jeddah",
            official_name: "Formula 1 STC Saudi Arabian Grand Prix 2025",
            event_name: "Saudi Arabian Grand Prix",
            event_date: "2025-03-09T18:00:00",
            event_format: "conventional",
            session5_date: "2025-03-09T18:00:00"
          },
          {
            round_number: 3,
            country: "Australia",
            location: "Melbourne",
            official_name: "Formula 1 Rolex Australian Grand Prix 2025",
            event_name: "Australian Grand Prix",
            event_date: "2025-03-16T05:00:00",
            event_format: "conventional",
            session5_date: "2025-03-16T05:00:00"
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchSchedule();
  }, [year]);

  return { 
    data, 
    loading, 
    error,
    // Utility functions
    refetch: () => {
      f1Cache.clear();
      setLoading(true);
    },
    getNextRace: () => {
      const now = new Date();
      return data
        .filter(race => 
          race.event_name.toLowerCase().includes('grand prix') ||
          race.official_name.toLowerCase().includes('grand prix')
        )
        .find(race => {
          const raceDate = new Date(race.session5_date || race.event_date);
          return raceDate > now;
        });
    },
    getRecentRaces: (count: number = 6) => {
      const now = new Date();
      return data
        .filter(race => 
          race.event_name.toLowerCase().includes('grand prix') ||
          race.official_name.toLowerCase().includes('grand prix')
        )
        .map(race => ({
          ...race,
          raceDate: new Date(race.session5_date || race.event_date),
          isCompleted: new Date(race.session5_date || race.event_date) < now
        }))
        .sort((a, b) => b.raceDate.getTime() - a.raceDate.getTime())
        .slice(0, count);
    },
    // Helper to get only Grand Prix races (excluding testing)
    getGrandPrixOnly: () => {
      return data.filter(race => 
        race.event_name.toLowerCase().includes('grand prix') ||
        race.official_name.toLowerCase().includes('grand prix')
      );
    }
  };
}
