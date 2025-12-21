import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateTypeReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun.ts';
import { MatrixOperationNewEmptyBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationNewEmpty.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { CoordinateBo, CoordinateBoi } from 'this/lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Coordinate.bun';

import create_empty_matrix_init from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_init.bun";
import create_empty_matrix_group from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_group.bun";
import create_empty_matrix_all_el from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_all_el.bun";
import create_empty_matrix_all_struct from "lib/domen/kc-e.mybpm.kz/KCE/Tasks/create_empty_matrix_all_struct.bun";

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

export type axis = keyof typeof axis;
export const axis = {
    District: CoordinateTypeReg['District'],
    Product_category: CoordinateTypeReg['Product_category'],
}

export type matrix = MatrixBoi;
export const matrix: matrix = ((axes: axis[]): matrix => {
    const oper = new MatrixOperationNewEmptyBoi()
    oper.coordinates_input_1['#значение'] = arrayToScratchFormat(axes) as unknown as ScratchArr<CoordinateBoi<CoordinateBo>>

    // Execute tasks synchronously
    // Note: These functions are defined as async but perform no actual async operations
    create_empty_matrix_init.call(oper);
    create_empty_matrix_group.call(oper);
    create_empty_matrix_all_el.call(oper);
    create_empty_matrix_all_struct.call(oper);

    return oper.matrix_output_1['#значение'] as unknown as matrix
}) as unknown as matrix

export default { axis, matrix };
