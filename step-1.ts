import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { Coordinate, matrix } from './matrix_types';
import { requests_by_period } from './initial_data.example'

const { First } = Coordinate;

export const requests_by_period_first_queue: matrix = filter_by_coordinate(requests_by_period, First);

export const requests_by_queue: matrix = matrix();

export const requests_by_market_participant: matrix = matrix();

export const requests_by_market_participant_region: matrix = matrix();
