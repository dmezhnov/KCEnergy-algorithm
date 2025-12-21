import { MatrixOperationSumByAxesBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationSumByAxes.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { matrix, axis } from './matrix_types'
import { CoordinateTypeBoi } from 'this/lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun';

import matrix_sum_by_axes_create_structure_1 from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_create_structure_1.bun";
import matrix_sum_by_axes_create_structure_2 from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_create_structure_2.bun";
import matrix_sum_by_axes_collect_traverse from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_collect_traverse.bun";
import matrix_sum_by_axes_calc_traverse from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_calc_traverse.bun";
import matrix_sum_by_axes_calc_process from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_calc_process.bun";

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

export const new_empty = () => {

}

export const sum_by_axes = (matrix_input: matrix, ...axis_input: axis[]): matrix => {
    const operation = new MatrixOperationSumByAxesBoi();

    operation.matrix_input_1['#значение'] = matrix_input;
    operation.axis_input_1['#значение'] = arrayToScratchFormat(axis_input) as unknown as ScratchArr<CoordinateTypeBoi>;

    // Execute tasks synchronously
    matrix_sum_by_axes_collect_traverse.call(operation);
    matrix_sum_by_axes_create_structure_1.call(operation);
    matrix_sum_by_axes_create_structure_2.call(operation);
    matrix_sum_by_axes_calc_traverse.call(operation);
    matrix_sum_by_axes_calc_process.call(operation);

    return operation.matrix_output_1['#значение'] as matrix;
}

export default {
    sum_by_axes,
    new_empty
}
