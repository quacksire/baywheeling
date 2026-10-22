'use client'

import * as baywheelStations from '@/data/baywheels_station_information.json'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, MapPin } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'

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
    <Card className="overflow-hidden rounded-lg border-white/10 bg-black/35 py-0 text-white shadow-none" aria-labelledby="station-leaderboard-title">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/70">Monthly rankings</p>
          <CardTitle id="station-leaderboard-title" className="text-sm font-semibold text-white">Station leaderboard</CardTitle>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={availableMonths.length === 0}
            aria-label="Choose leaderboard month"
            render={<Button variant="outline" className="min-h-11 w-[132px] justify-between border-white/15 bg-transparent px-2 text-xs text-gray-200 hover:bg-white/5 hover:text-white" />}
          >
            <span className="truncate">{selectedMonth ? formatMonth(selectedMonth) : 'No months'}</span>
            <ChevronDown className="size-3.5 shrink-0 text-gray-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 min-w-[132px] border-white/10 bg-gray-950 text-gray-200">
            <DropdownMenuRadioGroup
              value={selectedMonth}
              onValueChange={(value) => {
                latestMonthRequest.current = false
                setSelectedMonth(value)
              }}
            >
              {availableMonths.map((month) => (
                <DropdownMenuRadioItem key={month} value={month} className="focus:bg-white/10 focus:text-white">
                  {formatMonth(month)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        <ButtonGroup className="grid w-full grid-cols-4 gap-1 rounded-md bg-white/5 p-1" aria-label="Filter leaderboard by city">
          {cities.map((cityOption) => (
            <Button
              key={cityOption}
              type="button"
              aria-pressed={city === cityOption}
              onClick={() => setCity(cityOption)}
              variant={city === cityOption ? 'default' : 'ghost'}
              className={`h-auto min-h-11 min-w-0 rounded px-1 py-1.5 text-[10px] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none ${city === cityOption ? '' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}
            >
              {cityOption === 'San Francisco' ? 'SF' : cityOption === 'San Jose' ? 'SJ' : cityOption === 'Oakland' ? 'Oak' : 'All'}
            </Button>
          ))}
        </ButtonGroup>

        <ButtonGroup className="flex w-full gap-1 border-b border-white/10" aria-label="Rank stations by">
          {metrics.map((option) => (
            <Button
              key={option.id}
              type="button"
              aria-pressed={metric === option.id}
              onClick={() => setMetric(option.id)}
              variant={metric === option.id ? 'default' : 'ghost'}
              className={`h-auto min-h-11 flex-1 rounded-t-md rounded-b-none border-b-2 px-2 pb-2 text-xs transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none ${metric === option.id ? 'border-white' : 'border-transparent text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>

        <div className="min-h-[188px]">
          {isLoading ? (
            <div className="flex h-[188px] items-center justify-center gap-2 text-xs text-gray-400">
              <Spinner className="text-gray-300 motion-reduce:animate-none" /> Loading rankings
            </div>
          ) : error ? (
            <Alert className="my-6 border-white/10 bg-transparent text-gray-300">
              <AlertDescription className="text-center text-gray-400">{error}</AlertDescription>
            </Alert>
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
                  <li key={station.station_id} className="relative">
                    <Progress
                      value={maxCount ? (count / maxCount) * 100 : 0}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-2 inset-y-1/2 z-0 flex-nowrap -translate-y-1/2 gap-0"
                    >
                      <ProgressTrack className="h-[calc(100%-0.5rem)] rounded-sm bg-white/[0.025]">
                        <ProgressIndicator className="bg-white/[0.07] transition-[width] duration-200 ease-out motion-reduce:transition-none" />
                      </ProgressTrack>
                    </Progress>
                    <Button
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
                      variant="ghost"
                      className="group/button relative z-10 h-auto min-h-11 w-full justify-start gap-3 overflow-hidden rounded-md px-2 py-2 text-left transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none hover:bg-white/5 disabled:cursor-default disabled:opacity-100"
                    >
                      <span className="relative w-5 shrink-0 text-right font-mono text-[11px] text-gray-500">{String(index + 1).padStart(2, '0')}</span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-xs text-gray-100 group-hover/button:text-white">{station.station_name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                          {city === 'All' && <><MapPin className="h-2.5 w-2.5" />{cityShortName}<span className="px-0.5">·</span></>}
                          {metric === 'total' ? `${station.starts.toLocaleString()} starts · ${station.ends.toLocaleString()} ends` : city === 'All' ? cityShortName : metrics.find((item) => item.id === metric)?.countLabel}
                        </span>
                      </span>
                      <span className="relative shrink-0 pl-2 text-right font-mono text-xs tabular-nums text-white">
                        {count.toLocaleString()}
                        <span className="ml-1 text-[9px] font-sans text-gray-500">{metrics.find((item) => item.id === metric)?.countLabel}</span>
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-gray-500">
          {selectedMonth ? `${formatMonth(selectedMonth)} · ` : ''}Total uses = starts + ends. Select a station to open it on the map.
        </p>
      </CardContent>
    </Card>
  )
}
