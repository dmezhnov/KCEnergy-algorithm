import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { axis, matrix } from './matrix_types';
import { requests_by_period } from './initial_data.example'

export const requests_by_period_first_queue: matrix = matrix();

export const requests_by_queue: matrix = matrix();

export const requests_by_market_participant: matrix = matrix();

export const requests_by_market_participant_region: matrix = matrix();
