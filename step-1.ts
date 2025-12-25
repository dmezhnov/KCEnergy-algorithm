import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { Axis, Coordinate, matrix } from './matrix_types';
import { requests_i_j_k_l_l0 } from './initial_data.example'

const { First } = Coordinate;
const { Queue, Market_participant, Region } = Axis;

export const requests_i_j_k_l_l0_first: matrix = filter_by_coordinate(requests_i_j_k_l_l0, First);
requests_i_j_k_l_l0_first.matrix_title['#значение'] = 'requests_i_j_k_l_l0_first';


export const requests_by_queue: matrix = sum_by_axes(requests_i_j_k_l_l0, Queue);
requests_by_queue.matrix_title['#значение'] = 'requests_by_queue';

export const requests_by_market_participant: matrix = sum_by_axes(requests_by_queue, Market_participant);
requests_by_market_participant.matrix_title['#значение'] = 'requests_by_market_participant';

export const requests_by_market_participant_region: matrix = sum_by_axes(requests_by_queue, Region, Market_participant);
requests_by_market_participant_region.matrix_title['#значение'] = 'requests_by_market_participant_region';

if (import.meta.main) {
    await requests_i_j_k_l_l0_first.save('algorithm/build/step-1.lang', false);
    await requests_by_queue.save('algorithm/build/step-1.lang', true);
    await requests_by_market_participant.save('algorithm/build/step-1.lang', true);
    await requests_by_market_participant_region.save('algorithm/build/step-1.lang', true);
}
