import { MatrixOperationSumByAxesBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationSumByAxes.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateTypeBoi } from 'this/lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun';

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

export const sum_by_axes = async (matrix_input: MatrixBoi, ...axis_input: CoordinateTypeBoi[]): Promise<MatrixBoi> => {
    const operation = new MatrixOperationSumByAxesBoi();

    operation.matrix_input_1['#значение'] = matrix_input;
    operation.axis_input_1['#значение'] = arrayToScratchFormat(axis_input);

    await operation['#Запустить процесс']();

    return operation.matrix_output_1['#значение'] as MatrixBoi;
}

export default {
    sum_by_axes
}
