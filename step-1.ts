import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { Axis, Coordinate, matrix } from './matrix_types';
import { requests_by_period } from './initial_data.example'

const { First } = Coordinate;
const { Queue, Market_participant, Region } = Axis;

export const requests_by_period_first_queue: matrix = filter_by_coordinate(requests_by_period, First);

export const requests_by_queue: matrix = sum_by_axes(requests_by_period, Queue);

export const requests_by_market_participant: matrix = sum_by_axes(requests_by_queue, Market_participant);

export const requests_by_market_participant_region: matrix = sum_by_axes(requests_by_queue, Region, Market_participant);
