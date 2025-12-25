import { volumes_l_t_i_k_k0_i0 } from './initial_data.example';

import { sum_by_axes } from './matrix_operation';
import { Axis, matrix } from './matrix_types';
const { District, Product_category } = Axis;

export const volumes_l_t_i_k_k0: matrix = sum_by_axes(volumes_l_t_i_k_k0_i0, Product_category);
volumes_l_t_i_k_k0.matrix_title['#значение'] = 'volumes_l_t_i_k_k0';


export const volumes_l_t_i_k: matrix = sum_by_axes(volumes_l_t_i_k_k0_i0, District);
volumes_l_t_i_k.matrix_title['#значение'] = 'volumes_l_t_i_k';

if (import.meta.main) {
    await volumes_l_t_i_k_k0.save('algorithm/build/step-0.lang', false);
    await volumes_l_t_i_k.save('algorithm/build/step-0.lang', true);
}
