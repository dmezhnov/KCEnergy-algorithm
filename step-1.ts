import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { Axis, Coordinate, matrix } from './matrix_types';
import { requests_by_period } from './initial_data.example'

const { First } = Coordinate;
const { Queue, Market_participant, Region } = Axis;

export const requests_by_period_first_queue: matrix = filter_by_coordinate(requests_by_period, First);
requests_by_period_first_queue.matrix_title['#значение'] = 'requests_by_period_first_queue';
await requests_by_period_first_queue.save('algorithm/build/step-1.lang', false);

export const requests_by_queue: matrix = sum_by_axes(requests_by_period, Queue);
requests_by_queue.matrix_title['#значение'] = 'requests_by_queue';

await requests_by_queue.save('algorithm/build/step-1.lang', true);

export const requests_by_market_participant: matrix = sum_by_axes(requests_by_queue, Market_participant);
requests_by_market_participant.matrix_title['#значение'] = 'requests_by_market_participant';

await requests_by_market_participant.save('algorithm/build/step-1.lang', true);

export const requests_by_market_participant_region: matrix = sum_by_axes(requests_by_queue, Region, Market_participant);
requests_by_market_participant_region.matrix_title['#значение'] = 'requests_by_market_participant_region';

await requests_by_market_participant_region.save('algorithm/build/step-1.lang', true);
