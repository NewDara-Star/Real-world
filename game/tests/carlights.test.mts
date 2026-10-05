// Traffic cars' lights from what they're doing (trafficnet.ts carLights):
// -1 indicates left, 1 right, as the player's indicator does.
import { carLights } from "../src/client/trafficnet";
import { check, done } from "./check";

const car = (o: Partial<Parameters<typeof carLights>[0]> = {}) => ({
  v: 12, vPrev: 12, link: null, via: -1, lane: { length: 200 }, s: 50, lat: 0, latTarget: 0, ...o,
});
const dt = 1 / 30;
check("cruising: no brake lights, no indicator", !carLights(car(), dt).brake && carLights(car(), dt).indicator === 0);
check("slowing hard (3 m/s²): brake lights", carLights(car({ v: 12, vPrev: 12.1 }), dt).brake);
check("easing off gently (0.3 m/s²): no brake lights", !carLights(car({ v: 12, vPrev: 12.01 }), dt).brake);
check("standing at the lights: brake lights held on", carLights(car({ v: 0, vPrev: 0 }), dt).brake);
check("turning left 20 m before the junction: left indicator", carLights(car({ link: { dir: "l" }, s: 180 }), dt).indicator === -1);
check("turning right, still 100 m out: not yet", carLights(car({ link: { dir: "r" }, s: 100 }), dt).indicator === 0);
check("turning right in the junction: right indicator", carLights(car({ link: { dir: "r" }, via: 0 }), dt).indicator === 1);
check("going straight on: no indicator", carLights(car({ link: { dir: "s" }, s: 190 }), dt).indicator === 0);
check("pulling out to overtake on the right (lateral +left): right indicator", carLights(car({ lat: 0, latTarget: -3 }), dt).indicator === 1);
check("moving back in to the left: left indicator", carLights(car({ lat: -3, latTarget: 0 }), dt).indicator === -1);
check("a lane change beats the junction turn", carLights(car({ link: { dir: "r" }, s: 190, lat: 0, latTarget: 3 }), dt).indicator === -1);
check("a U-turn signals right where traffic keeps left", carLights(car({ link: { dir: "t" }, via: 0 }), dt, true).indicator === 1);
check("and left where it keeps right", carLights(car({ link: { dir: "t" }, via: 0 }), dt, false).indicator === -1);
check("a paused frame (dt 0) doesn't read as braking while moving", !carLights(car({ v: 10, vPrev: 12 }), 0).brake);
done();
