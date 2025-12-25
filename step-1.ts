import { filter_by_coordinate, sum_by_axes } from './matrix_operation';
import { Axis, Coordinate, matrix } from './matrix_types';
import { requests_i_j_k_l_l0 } from './initial_data.example'

const { First } = Coordinate;
const { Queue, Market_participant, Region } = Axis;

export const requests_i_j_k_l_l0_first: matrix = filter_by_coordinate(requests_i_j_k_l_l0, First);
requests_i_j_k_l_l0_first.matrix_title['#значение'] = 'requests_i_j_k_l_l0_first';


export const requests_i_j_k_l: matrix = sum_by_axes(requests_i_j_k_l_l0, Queue);
requests_i_j_k_l.matrix_title['#значение'] = 'requests_i_j_k_l';

export const requests_i_j_k: matrix = sum_by_axes(requests_i_j_k_l, Market_participant);
requests_i_j_k.matrix_title['#значение'] = 'requests_i_j_k';

export const requests_i_j: matrix = sum_by_axes(requests_i_j_k_l, Region, Market_participant);
requests_i_j.matrix_title['#значение'] = 'requests_i_j';

if (import.meta.main) {
    await requests_i_j_k_l_l0_first.save('algorithm/build/step-1.lang', false);
    await requests_i_j_k_l.save('algorithm/build/step-1.lang', true);
    await requests_i_j_k.save('algorithm/build/step-1.lang', true);
    await requests_i_j.save('algorithm/build/step-1.lang', true);
}
