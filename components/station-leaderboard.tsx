'use client'

import * as baywheelStations from '@/data/baywheels_station_information.json'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'

type City = 'All' | 'San Francisco' | 'Oakland' | 'San Jose'
type Metric = 'total' | 'starts' | 'ends'

interface StationUsage {
  station_id: string;
  station_name: string;
  starts: number;
  ends: number;
  city: string;
}

interface StationSelection {
  id: string;
  shortName: string;
  name: string;
  coordinates: [number, number];
}

interface StationLeaderboardProps {
  onSelectStation: (station: StationSelection, yearMonth: string) => void;
  availableMonths: string[];
  initialMonth: string;
}

const cities: City[] = ['All', 'San Francisco', 'Oakland', 'San Jose']
const metrics: { id: Metric; label: string; countLabel: string }[] = [
  { id: 'total', label: 'Most used', countLabel: 'uses' },
  { id: 'starts', label: 'Starts', countLabel: 'starts' },
  { id: 'ends', label: 'Ends', countLabel: 'ends' },
]

const cityShortNames: Record<string, string> = {
  'San Francisco': 'SF',
  Oakland: 'Oak',
  'San Jose': 'SJ',
}

function formatMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function StationLeaderboard({ onSelectStation, availableMonths, initialMonth }: StationLeaderboardProps) {
  const [selectedMonth, setSelectedMonth] = useState(initialMonth)
  const [stations, setStations] = useState<StationUsage[]>([])
  const [city, setCity] = useState<City>('All')
  const [metric, setMetric] = useState<Metric>('total')
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false)
  const [error, setError] = useState('')
  const latestMonthRequest = useRef(Boolean(initialMonth))
  const skipFetchForMonth = useRef('')

  useEffect(() => {
    if (!selectedMonth && initialMonth) {
      latestMonthRequest.current = true
      setSelectedMonth(initialMonth)
    }
  }, [initialMonth, selectedMonth])

  useEffect(() => {
    if (!selectedMonth) return
    if (skipFetchForMonth.current === selectedMonth) {
      skipFetchForMonth.current = ''
      return
    }

    const controller = new AbortController()
    const requestedMonth = latestMonthRequest.current ? 'latest' : selectedMonth
    setLoadingLeaderboard(true)
    setError('')

    fetch(`/api/leaderboard?year_month=${encodeURIComponent(requestedMonth)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Could not load station rankings')
        return response.json()
      })
      .then((responseData) => {
        const data = responseData as { yearMonth?: string | null; stations?: StationUsage[] }
        if (controller.signal.aborted) return
        setStations(Array.isArray(data.stations) ? data.stations : [])
        if (latestMonthRequest.current) {
          latestMonthRequest.current = false
          if (data.yearMonth && data.yearMonth !== selectedMonth) {
            skipFetchForMonth.current = data.yearMonth
            setSelectedMonth(data.yearMonth)
          }
        }
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) {
          latestMonthRequest.current = false
          setError(fetchError instanceof Error ? fetchError.message : 'Could not load station rankings')
          setStations([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingLeaderboard(false)
      })

    return () => controller.abort()
  }, [selectedMonth])

  const rankedStations = useMemo(() => {
    return stations
      .filter((station) => city === 'All' || station.city === city)
      .sort((left, right) => {
        const leftCount = metric === 'total' ? left.starts + left.ends : left[metric]
        const rightCount = metric === 'total' ? right.starts + right.ends : right[metric]
        return rightCount - leftCount || left.station_name.localeCompare(right.station_name)
      })
      .slice(0, 5)
  }, [stations, city, metric])

  const stationInfo = useMemo(() => {
    const data = baywheelStations as { data?: { stations?: Array<{
      station_id: string;
      short_name: string;
      name: string;
      lat: number;
      lon: number;
    }> } }
    return new Map((data.data?.stations || []).map((station) => [station.short_name, station]))
  }, [])

  const maxCount = rankedStations.reduce((max, station) => {
    const count = metric === 'total' ? station.starts + station.ends : station[metric]
    return Math.max(max, count)
  }, 0)

  const isLoading = loadingLeaderboard || (availableMonths.length > 0 && !selectedMonth)

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-black/35" aria-labelledby="station-leaderboard-title">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/70">Monthly rankings</p>
          <h3 id="station-leaderboard-title" className="text-sm font-semibold text-white">Station leaderboard</h3>
        </div>
        <label className="sr-only" htmlFor="leaderboard-month">Choose leaderboard month</label>
        <select
          id="leaderboard-month"
          value={selectedMonth}
          onChange={(event) => {
            latestMonthRequest.current = false
            setSelectedMonth(event.target.value)
          }}
          disabled={availableMonths.length === 0}
          className="min-h-11 w-[118px] min-w-0 rounded-md border border-white/15 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
        >
          {availableMonths.length === 0 && <option value="">No months</option>}
          {availableMonths.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-4 gap-1 rounded-md bg-white/5 p-1" role="group" aria-label="Filter leaderboard by city">
          {cities.map((cityOption) => (
            <button
              key={cityOption}
              type="button"
              aria-pressed={city === cityOption}
              onClick={() => setCity(cityOption)}
              className={`min-h-11 rounded px-1 py-1.5 text-[10px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${city === cityOption ? 'bg-white text-gray-950' : 'text-gray-400 hover:text-white'}`}
            >
              {cityOption === 'San Francisco' ? 'SF' : cityOption === 'San Jose' ? 'SJ' : cityOption === 'Oakland' ? 'Oak' : 'All'}
            </button>
          ))}
        </div>

        <div className="flex gap-4 border-b border-white/10" role="group" aria-label="Rank stations by">
          {metrics.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={metric === option.id}
              onClick={() => setMetric(option.id)}
              className={`-mb-px flex min-h-11 items-center border-b-2 pb-2 text-xs transition-[border-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${metric === option.id ? 'border-white text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="min-h-[188px]">
          {isLoading ? (
            <div className="flex h-[188px] items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Loading rankings
            </div>
          ) : error ? (
            <p className="py-8 text-center text-xs text-gray-400">{error}</p>
          ) : rankedStations.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">No station rides found for this month.</p>
          ) : (
            <ol className="space-y-1">
              {rankedStations.map((station, index) => {
                const count = metric === 'total' ? station.starts + station.ends : station[metric]
                const metadata = stationInfo.get(station.station_id)
                const isClickable = Boolean(metadata)
                const cityShortName = cityShortNames[station.city] || station.city

                return (
                  <li key={station.station_id}>
                    <button
                      type="button"
                      disabled={!isClickable}
                      onClick={() => {
                        if (!metadata) return
                        onSelectStation({
                          id: metadata.station_id,
                          shortName: metadata.short_name,
                          name: metadata.name || station.station_name,
                          coordinates: [metadata.lon, metadata.lat],
                        }, selectedMonth)
                      }}
                      className="group relative flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-md px-2 py-2 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-default"
                    >
                      <span
                        className="absolute inset-y-1 left-0 w-full origin-left rounded-sm bg-white/[0.07] transition-transform duration-200 ease-out motion-reduce:transition-none"
                        style={{ transform: `scaleX(${Math.max(0.05, count / maxCount)})` }}
                        aria-hidden="true"
                      />
                      <span className="relative w-5 shrink-0 text-right font-mono text-[11px] text-gray-500">{String(index + 1).padStart(2, '0')}</span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-xs text-gray-100 group-hover:text-white">{station.station_name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                          {city === 'All' && <><MapPin className="h-2.5 w-2.5" />{cityShortName}<span className="px-0.5">·</span></>}
                          {metric === 'total' ? `${station.starts.toLocaleString()} starts · ${station.ends.toLocaleString()} ends` : city === 'All' ? cityShortName : metrics.find((item) => item.id === metric)?.countLabel}
                        </span>
                      </span>
                      <span className="relative shrink-0 pl-2 text-right font-mono text-xs tabular-nums text-white">
                        {count.toLocaleString()}
                        <span className="ml-1 text-[9px] font-sans text-gray-500">{metrics.find((item) => item.id === metric)?.countLabel}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-gray-500">
          {selectedMonth ? `${formatMonth(selectedMonth)} · ` : ''}Total uses = starts + ends. Select a station to open it on the map.
        </p>
      </div>
    </section>
  )
}
