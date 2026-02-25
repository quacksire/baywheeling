import {Map, MapControls} from "@/components/ui/map";
import { StationLayer} from "@/components/stationlayer";

export default function Home() {
  return (
      <div className="h-dvh w-screen overflow-hidden flex flex-col">
          <Map center={[-122.29181, 37.69828]} zoom={8} className="flex-1">
              <MapControls />
              <StationLayer />
          </Map>
      </div>
  );
}
