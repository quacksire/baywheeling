'use client'

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Grid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/dither-kit";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Progress } from "./ui/progress";
import {ButtonGroup} from "@/components/ui/button-group";
import {Button} from "@/components/ui/button";

interface StationStats {
  total_rides: number;
  member_count: number;
  casual_count: number;
  false_starts: number;
  avg_ride_seconds: number | null;
  longest_ride_seconds: number | null;
  rideableTypes: Array<{ rideable_type: string; count: number }>;
  dayOfWeek: Array<{ day_num: string; count: number }>;
  destinations: Array<{ end_station_name: string; count: number }>;
  busiestHours: Array<{ hour: string; count: number }>;
}

interface StationInfoContentProps {
  stationName: string;
  ridesCount: number;
  selectedMonth: string;
  selectedYear: string;
  selectedMonthNum: string;
  stats: StationStats | null;
  statsLoading: boolean;
  statsError: boolean;
  loadingRides: boolean;
  routesLoading: number;
  routesTotal: number;
  isCurrentMonth: boolean;
  availableMonths: string[];
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onMonthChange: (yearMonth: string) => void;
  onRefreshMonths: () => void;
}

const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

function formatDuration(seconds: number | null | undefined) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";

    const totalSeconds = Math.round(seconds);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
}
/*
These stations don't have physical docks but are included in the dataset as virtual stations representing popular ride start/end points.
But they don't have a ride data associated with them, so we should exclude them from the station stats view to avoid confusion.
Still show them in the map and allow users to click on them to see the "no rides" message, but exclude from month navigation and stats since they will always show zero rides and skew the false start percentage.

 */
const virtualStations = [
    "bowling green",
    "stowe lake",
    "lloyd lake",
    "hellman hollow",
    "30th ave",
    "south lake",
    "chain o’ lakes",
    "vincente st at great hwy",
    "sloat blvd at the great highway to 46th ave",
    "taraval st at 41st ",
    "taraval st at 40th",
    "taraval st at 26th ",
    "taraval st at 22nd ",
    "forest hill ",
    "laguna honda hospital",
    "ocean ave west: to fairfield way",
    "ocean avenue east: to plymouth ave",
    "mission at whipple",
]

function ChartSkeleton({ labelWidth = "w-24" }: { labelWidth?: string }) {
  return (
    <div className="mx-[-1rem]" aria-hidden="true">
      <div className="mb-2 px-4">
        <Skeleton className={`h-3 ${labelWidth}`} />
      </div>
      <Skeleton className="h-[120px] w-full" />
    </div>
  );
}

function DestinationsSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="mb-2 h-3 w-32" />
      <div className="space-y-2">
        {["w-5/6", "w-3/4", "w-4/5", "w-2/3", "w-3/4"].map((width, index) => (
          <div key={index} className="flex h-5 items-center justify-between gap-3">
            <Skeleton className={`h-3 ${width}`} />
            <Skeleton className="h-5 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function   StationInfoContent({
  stationName,
  ridesCount,
  selectedMonth,
  selectedYear,
  selectedMonthNum,
  stats,
  statsLoading,
  statsError,
  loadingRides,
  routesLoading,
  routesTotal,
  isCurrentMonth,
  availableMonths,
  onPreviousMonth,
  onNextMonth,
  onMonthChange,
  onRefreshMonths,
}: StationInfoContentProps) {

    const isVirtualStation = virtualStations.includes(stationName.toLowerCase());
    console.log(stationName.toLowerCase());
    console.log(virtualStations);
    const statsRideCount = stats?.total_rides ?? 0;
    const effectiveRidesCount = Math.max(ridesCount, statsRideCount);
    const availableYears = Array.from(
        new Set(availableMonths.map((yearMonth) => yearMonth.split('-')[0]))
    ).sort((a, b) => b.localeCompare(a));
    const availableMonthsForYear = availableMonths
        .filter((yearMonth) => yearMonth.startsWith(`${selectedYear}-`))
        .map((yearMonth) => yearMonth.split('-')[1])
        .sort((a, b) => parseInt(b) - parseInt(a));
    const hasAnyRideSignal = effectiveRidesCount > 0;
    const isInitialDataLoading = loadingRides || (statsLoading && !stats);
    const showStatsLayout = !isVirtualStation && Boolean(selectedMonth) && (statsLoading || Boolean(stats));
    const hasStatsBackfill = !loadingRides && ridesCount === 0 && statsRideCount > 0;
    const dayOfWeekChartData = useMemo(
        () => stats?.dayOfWeek?.map((d) => ({
            ...d,
            day_name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
                parseInt(d.day_num) || 0
            ],
        })) ?? [],
        [stats?.dayOfWeek]
    );
    const busiestHoursChartData = useMemo(
        () => stats?.busiestHours?.map((h) => ({
            ...h,
            hour_label: `${h.hour}:00`,
        })) ?? [],
        [stats?.busiestHours]
    );
    const rideableTypeConfig = useMemo(() => {
        const colors = ["blue", "purple", "pink", "orange", "green", "red", "grey"] as const;
        return Object.fromEntries(
            (stats?.rideableTypes ?? []).map((rideableType, index) => [
                rideableType.rideable_type,
                {
                    label: rideableType.rideable_type,
                    color: colors[index % colors.length],
                },
            ])
        );
    }, [stats?.rideableTypes]);

    const handleYearChange = (year: string) => {
        onRefreshMonths();
        const currentMonthForYear = selectedMonthNum
            ? `${year}-${selectedMonthNum}`
            : '';
        const targetMonth = parseInt(selectedMonthNum || '1', 10);
        const fallbackMonth = availableMonths
            .filter((yearMonth) => yearMonth.startsWith(`${year}-`))
            .sort((a, b) => {
                const aMonth = parseInt(a.split('-')[1], 10);
                const bMonth = parseInt(b.split('-')[1], 10);
                const distance = Math.abs(aMonth - targetMonth) - Math.abs(bMonth - targetMonth);
                return distance || aMonth - bMonth;
            })[0];

        if (availableMonths.includes(currentMonthForYear)) {
            onMonthChange(currentMonthForYear);
            return;
        }

        if (fallbackMonth) {
            onMonthChange(fallbackMonth);
        }
    };

    const handleMonthSelectChange = (month: string) => {
        onRefreshMonths();
        if (selectedYear && month) {
            onMonthChange(`${selectedYear}-${month}`);
        }
    };


  return (
    <div>
      <h3 className="font-bold text-base mb-1">{stationName}</h3>
      <p className="text-xs text-muted-foreground mb-4" aria-live="polite">
        {isInitialDataLoading ? "Loading recorded rides…" : `${effectiveRidesCount} recorded rides`}
      </p>

        {isVirtualStation && (
            <Item variant={'outline'} size="sm" className="mb-4">
                <ItemMedia>
                    {/* TODO: Add an icon for no data */}
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>
                        This is a virtual stop, not a physical dock.
                    </ItemTitle>
                    <ItemDescription>
                        Some entries in the dataset mark common pickup or dropoff areas rather than docked stations. They stay on the map for context, but they will not show ride totals or monthly stats.
                    </ItemDescription>
                </ItemContent>
            </Item>
        )}

      {/* Status/Loading Section */}
      {!isVirtualStation && !selectedMonth && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon to pick a time */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Pick a month to start exploring</ItemTitle>
              <ItemDescription>Choose a year and month below to load this dock&apos;s snapshot.</ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && !statsLoading && statsError && !stats && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              <AlertCircle className="size-5 text-muted-foreground" aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Station stats are not ready</ItemTitle>
              <ItemDescription>
                Ride routes can still appear while this month&apos;s summary is unavailable. Try this month again shortly.
              </ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && routesLoading < routesTotal && routesTotal > 0 && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Tracing the routes riders took next</ItemTitle>
              <ItemDescription>{routesLoading} of {routesTotal} route paths ready.</ItemDescription>
                <Progress value={routesLoading} max={routesTotal} className="w-full" />
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && hasStatsBackfill && (
          <Item variant={'outline'} size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Ride details are still syncing</ItemTitle>
              <ItemDescription>
                  We found ride totals for {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear}, but the trip list for this dock has not caught up yet.
              </ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && !statsLoading && !statsError && !hasAnyRideSignal && !hasStatsBackfill && (
          <Item variant={'default'} size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon for no data */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Quiet month at this dock</ItemTitle>
              <ItemDescription>No rides were recorded here in {monthNames[parseInt(selectedMonthNum) - 1] } {selectedYear}.</ItemDescription>
            </ItemContent>
          </Item>
      )}

      {/* Stats section */}
      {showStatsLayout && (
        <div className="space-y-3" aria-busy={statsLoading}>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Total Rides</p>
              {stats ? (
                <p className="font-bold text-lg">{stats.total_rides}</p>
              ) : (
                <Skeleton className="mt-1 h-5 w-12 bg-background/40" />
              )}
            </div>
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">False Starts</p>
              {stats ? (
                <>
                  <p className="font-bold text-lg">
                    {stats.total_rides > 0
                      ? `${((stats.false_starts / stats.total_rides) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </p>
                  <p className="text-xs text-muted-foreground">{stats.false_starts} rides</p>
                </>
              ) : (
                <div className="mt-1 space-y-1">
                  <Skeleton className="h-5 w-14 bg-background/40" />
                  <Skeleton className="h-3 w-12 bg-background/40" />
                </div>
              )}
            </div>
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Avg Ride Time</p>
              {stats ? (
                <p className="font-bold text-lg">{formatDuration(stats.avg_ride_seconds)}</p>
              ) : (
                <Skeleton className="mt-1 h-5 w-16 bg-background/40" />
              )}
            </div>
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Longest Ride</p>
              {stats ? (
                <p className="font-bold text-lg">{formatDuration(stats.longest_ride_seconds)}</p>
              ) : (
                <Skeleton className="mt-1 h-5 w-16 bg-background/40" />
              )}
            </div>
          </div>

          {/* Rideable Type Chart */}
          {statsLoading && !stats?.rideableTypes ? (
              <>
                <Separator />
                <ChartSkeleton labelWidth="w-28" />
              </>
          ) : stats?.rideableTypes && stats.rideableTypes.length > 0 ? (
              <>
                <Separator />
                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">Bike Type Usage</p>
                  <PieChart
                    data={stats.rideableTypes}
                    config={rideableTypeConfig}
                    dataKey="count"
                    nameKey="rideable_type"
                    className="h-[120px]"
                    bloom="low"
                  >
                    <Pie variant="gradient" />
                    <Legend isClickable align="right" />
                  </PieChart>
                </div>
              </>
          ) : null}

          {/* Day of Week Chart */}
          {statsLoading && !stats?.dayOfWeek ? (
              <>
                <Separator />
                <ChartSkeleton />
              </>
          ) : stats?.dayOfWeek && stats.dayOfWeek.length > 0 ? (
              <>
                <Separator />
                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Weekday pattern
                  </p>
                  <LineChart
                    data={dayOfWeekChartData}
                    config={{ count: { label: "Rides", color: "purple" } }}
                    className="h-[120px]"
                    bloom="low"
                  >
                    <Grid />
                    <XAxis dataKey="day_name" />
                    <YAxis />
                    <Line dataKey="count" variant="dotted" />
                  </LineChart>
                </div>
              </>
          ) : null}

          {/* Busiest Hours */}
          {statsLoading && !stats?.busiestHours ? (
              <>
                <Separator />
                <ChartSkeleton />
              </>
          ) : stats?.busiestHours && stats.busiestHours.length > 0 ? (
              <>
                <Separator />
                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Busiest hours
                  </p>
                  <LineChart
                    data={busiestHoursChartData}
                    config={{ count: { label: "Rides", color: "orange" } }}
                    className="h-[120px]"
                    bloom="aura"
                  >
                    <Grid />
                    <XAxis dataKey="hour_label" maxTicks={8} />
                    <YAxis />
                    <Tooltip labelKey="hour_label" />
                    <Line dataKey="count" variant="gradient" />
                  </LineChart>
                </div>
              </>
          ) : null}

          {/* Top Destinations */}
          {statsLoading && !stats?.destinations ? (
              <>
                <Separator />
                <DestinationsSkeleton />
              </>
          ) : stats?.destinations && stats.destinations.length > 0 ? (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Where riders went next</p>
                  <div className="space-y-2">
                    {stats.destinations.map((dest, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="truncate flex-1">{dest.end_station_name}</span>
                        <Badge variant="outline" className="text-xs ml-2">
                          {dest.count}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
          ) : null}
        </div>
      )}

      {/* Month Navigation */}
      <div className="mt-4 space-y-3">

          <div className={'w-full text-center text-xs text-muted-foreground'}>
              Time window
          </div>

          <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Year</span>
                  <select
                      value={selectedYear}
                      onFocus={onRefreshMonths}
                      onMouseDown={onRefreshMonths}
                      onChange={(event) => handleYearChange(event.target.value)}
                      disabled={loadingRides || availableYears.length === 0}
                      aria-label="Select ride year"
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 h-9 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                      {availableYears.map((year) => (
                          <option key={year} value={year}>
                              {year}
                          </option>
                      ))}
                  </select>
              </label>

              <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Month</span>
                  <select
                      value={selectedMonthNum}
                      onFocus={onRefreshMonths}
                      onMouseDown={onRefreshMonths}
                      onChange={(event) => handleMonthSelectChange(event.target.value)}
                      disabled={loadingRides || availableMonthsForYear.length === 0}
                      aria-label="Select ride month"
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 h-9 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                      {availableMonthsForYear.map((month) => (
                          <option key={month} value={month}>
                              {monthNames[parseInt(month) - 1]}
                          </option>
                      ))}
                  </select>
              </label>
          </div>

          <ButtonGroup className="flex items-center justify-between gap-3 w-full">
              <Button variant={'ghost'} className={'flex items-center'}
                      onClick={onPreviousMonth}
                      disabled={loadingRides}>
                  <ChevronLeft className="h-4 w-4" />
                  <span>Previous</span>

              </Button>

              {selectedMonth && (
                  <Button className="text-center text-sm font-medium text-white">
                      {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear}
                  </Button>
              )}

              <Button variant={'ghost'} className={'flex items-center'}
                      onClick={onNextMonth}
                      disabled={loadingRides || isCurrentMonth}>
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" />

              </Button>


          </ButtonGroup>
      </div>
    </div>
  );
}
