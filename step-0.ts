import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { MatrixOperationSumByAxesBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationSumByAxes.bun';
import { volumes_by_period } from './initial_data.example';
import { CoordinateTypeReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun.ts';

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

const matrixFor = (matrix: MatrixBoi, callback: (el: MatrixBoi) => void) => {
    if (matrix.matrix_children['#количество'] > 0) {
        for (const el of matrix.matrix_children['#значение']) {
            matrixFor(el as MatrixBoi, callback);
        }
    } else {
        callback(matrix);
    }
}

const volumesByProductCategoryOperation = new MatrixOperationSumByAxesBoi();

volumesByProductCategoryOperation.matrix_input_1['#значение'] = volumes_by_period;
volumesByProductCategoryOperation.axis_input_1['#значение'] = arrayToScratchFormat([CoordinateTypeReg['PRODUCT_CATEGORY']]);
volumesByProductCategoryOperation['#Запустить процесс']();

const volumes_by_product_category: MatrixBoi = volumesByProductCategoryOperation.matrix_output_1['#значение'] as MatrixBoi;

const volumesByProductCategoryDistrictOperation = new MatrixOperationSumByAxesBoi();

volumesByProductCategoryDistrictOperation.matrix_input_1['#значение'] = volumes_by_period;
volumesByProductCategoryDistrictOperation.axis_input_1['#значение'] = arrayToScratchFormat([CoordinateTypeReg['DISTRICT']]);
volumesByProductCategoryDistrictOperation['#Запустить процесс']();

const volumes_by_product_category_district: MatrixBoi = volumesByProductCategoryDistrictOperation.matrix_output_1['#значение'] as MatrixBoi;
