'use client'

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { ChartTooltip } from "@/components/ui/chart";
import {
  Item,
  ItemActions,
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
  loadingRides: boolean;
  routesLoading: number;
  routesTotal: number;
  isCurrentMonth: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
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

export function   StationInfoContent({
  stationName,
  ridesCount,
  selectedMonth,
  selectedYear,
  selectedMonthNum,
  stats,
  loadingRides,
  routesLoading,
  routesTotal,
  isCurrentMonth,
  onPreviousMonth,
  onNextMonth,
}: StationInfoContentProps) {
  return (
    <div>
      <h3 className="font-bold text-base mb-1">{stationName}</h3>
      <p className="text-xs text-muted-foreground mb-4">{ridesCount} rides</p>

      {/* Status/Loading Section */}
      {!selectedMonth && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon to pick a time */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Select a year and month to view rides</ItemTitle>
            </ItemContent>
          </Item>
      )}

      {selectedMonth && loadingRides && (
          <Item variant="outline" size="sm" className="mb-4">
              <ItemMedia>
                <Spinner className="size-5" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Loading dock data...</ItemTitle>
                <ItemDescription>Fetching ride records</ItemDescription>
              </ItemContent>
          </Item>
      )}

      {selectedMonth && !loadingRides && routesLoading < routesTotal && routesTotal > 0 && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Mapping rides...</ItemTitle>
              <ItemDescription>{routesLoading} / {routesTotal} route paths calculated</ItemDescription>
                <Progress value={routesLoading} max={routesTotal} className="w-full" />
            </ItemContent>
          </Item>
      )}

      {selectedMonth && !loadingRides && ridesCount === 0 && (
          <Item variant={'default'} size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon for no data */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>No rides found for this dock in {monthNames[parseInt(selectedMonthNum) - 1] } {selectedYear}</ItemTitle>
            </ItemContent>
          </Item>
      )}

      {/* Stats section */}
      {selectedMonth && !loadingRides && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Total Rides</p>
              <p className="font-bold text-lg">{stats.total_rides}</p>
            </div>
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">False Starts</p>
              <p className="font-bold text-lg">
                {((stats.false_starts / stats.total_rides) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">{stats.false_starts} rides</p>
            </div>
          </div>

          {/* Rideable Type Chart */}
          {stats.rideableTypes && stats.rideableTypes.length > 0 && (
              <>
                <Separator />

                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">Bike Type Usage</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={stats.rideableTypes} margin={{ left: -30, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 84%)" />
                      <XAxis dataKey="rideable_type" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Bar dataKey="count" fill="hsl(221.2, 83.2%, 53.3%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>

          )}

          {/* Day of Week Chart */}
          {stats.dayOfWeek && stats.dayOfWeek.length > 0 && (
              <>

                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Rides by Day of Week
                  </p>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart
                        data={stats.dayOfWeek.map((d) => ({
                          ...d,
                          day_name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
                          parseInt(d.day_num) || 0
                              ],
                        }))}
                        margin={{ left: -30, right: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 84%)" />
                      <XAxis dataKey="day_name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Bar dataKey="count" fill="hsl(217.2, 91.2%, 59.8%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>

          )}

          {/* Busiest Hours */}
          {stats.busiestHours && stats.busiestHours.length > 0 && (
              <>
              <Separator />
                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Busiest Times (Hour of Day)
                  </p>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart
                        data={stats.busiestHours.map((h) => ({
                          ...h,
                          hour_label: `${h.hour}:00`,
                        }))}
                        margin={{ left: -30, right: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 84%)" />
                      <XAxis dataKey="hour_label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip />
                      <Bar dataKey="count" fill="hsl(49.9, 89.6%, 51.4%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>


          )}

          <Separator />

          {/* Top Destinations */}
          {stats.destinations && stats.destinations.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Top 5 Destinations</p>
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
          )}
        </div>
      )}

      {/* Month Navigation */}
      <div className="mt-4 space-y-3">

          <div className={'w-full text-center'}>
              Showing rides from
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
