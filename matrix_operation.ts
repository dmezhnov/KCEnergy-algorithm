import { MatrixOperationSumByAxesBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationSumByAxes.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { matrix, axis, coordinate } from './matrix_types'
import { CoordinateTypeBoi } from 'this/lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun';
import { MatrixOperationNewEmptyBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationNewEmpty.bun';
import { MatrixOperationFilterByCoordinateBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationFilterByCoordinate.bun';

import matrix_sum_by_axes_create_structure_1 from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_create_structure_1.bun";
import matrix_sum_by_axes_create_structure_2 from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_create_structure_2.bun";
import matrix_sum_by_axes_collect_traverse from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_collect_traverse.bun";
import matrix_sum_by_axes_calc_traverse from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_calc_traverse.bun";
import matrix_sum_by_axes_calc_process from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_sum_by_axes_calc_process.bun";

import create_empty_matrix_init from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_init.bun";
import create_empty_matrix_group from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_group.bun";
import create_empty_matrix_all_el from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_all_el.bun";
import create_empty_matrix_all_struct from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_all_struct.bun";
import { CoordinateBo, CoordinateBoi } from 'this/lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Coordinate.bun';

import matrix_filter_by_coord_finalize from 'this/lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_filter_by_coord_finalize.bun';
import matrix_filter_by_coord_traverse from 'this/lib/domen/kc-e.mybpm.kz/KCE/Tasks/matrix_filter_by_coord_traverse.bun';

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

export const new_empty = <
    TAxes extends axis[] = axis[],
    TAxis extends axis = TAxes[number]
>(...coords: coordinate<TAxis>[]): matrix<TAxes> => {
    const oper = new MatrixOperationNewEmptyBoi()
    oper.coordinates_input_1['#значение'] = arrayToScratchFormat(coords) as unknown as ScratchArr<TAxis & CoordinateBoi<CoordinateBo>>

    create_empty_matrix_init.call(oper);
    create_empty_matrix_group.call(oper);
    create_empty_matrix_all_el.call(oper);
    create_empty_matrix_all_struct.call(oper);

    return oper.matrix_output_1['#значение'] as matrix<TAxes>
}

export const sum_by_axes = <
    Taxes extends axis[] = axis[],
    TaxesSum extends axis[] = axis[],
    TAxesAfter extends axis[] = Exclude<Taxes[number], TaxesSum[number]>[]
    >(matrix_input: matrix<Taxes>, ...axis_input: TaxesSum): matrix<TAxesAfter> => {
    const operation = new MatrixOperationSumByAxesBoi();

    operation.matrix_input_1['#значение'] = matrix_input;
    operation.axis_input_1['#значение'] = arrayToScratchFormat(axis_input) as unknown as ScratchArr<TaxesSum & CoordinateTypeBoi>;

    matrix_sum_by_axes_collect_traverse.call(operation);
    matrix_sum_by_axes_create_structure_1.call(operation);
    matrix_sum_by_axes_create_structure_2.call(operation);
    matrix_sum_by_axes_calc_traverse.call(operation);
    matrix_sum_by_axes_calc_process.call(operation);

    return operation.matrix_output_1['#значение'] as matrix<TAxesAfter>;
}

export const filter_by_coordinate = <
    TCoords extends coordinate[] = coordinate[],
    TCoord extends coordinate = TCoords[number]
>(matrix_input: matrix, ...coordinate_input: TCoords): matrix => {
    const operation = new MatrixOperationFilterByCoordinateBoi();

    operation.matrix_input_1['#значение'] = matrix_input;
    operation.coordinates_input_1['#значение'] = arrayToScratchFormat(coordinate_input) as unknown as ScratchArr<TCoord & CoordinateBoi<CoordinateBo>>;

    matrix_filter_by_coord_traverse.call(operation);
    matrix_filter_by_coord_finalize.call(operation);

    return operation.matrix_output_1['#значение'] as matrix;
}

export default {
    sum_by_axes,
    new_empty,
    filter_by_coordinate
}
