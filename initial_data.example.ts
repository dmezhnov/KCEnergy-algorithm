import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Coordinate.bun';
import { MatrixOperationNewEmptyBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationNewEmpty.bun';
import createMatrix from 'lib/utils/createMatrix.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';

const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

const newEmptyMAtrixOper = new MatrixOperationNewEmptyBoi();
newEmptyMAtrixOper.coordinates_input_1['#значение'] = arrayToScratchFormat([
    CoordinateReg['BENZIN_AI_92'],
    CoordinateReg['ANPZ'],
    CoordinateReg['PKOP'],
    CoordinateReg['PNHZ'],
    CoordinateReg['Almaty'],
    CoordinateReg['Astana'],
    CoordinateReg['Shymkent'],
    CoordinateReg['«А.»'],
    CoordinateReg['«Б.»'],
    CoordinateReg['«В.»'],
    CoordinateReg['«Г.»'],
    CoordinateReg['«Д.»'],
    CoordinateReg['«Е.»'],
])

await newEmptyMAtrixOper['#Запустить процесс']();

export const requests_by_period: MatrixBoi = newEmptyMAtrixOper.matrix_output_1['#значение'] as MatrixBoi;

export const volumes_by_period: MatrixBoi = createMatrix();

export const available_by_refinery: MatrixBoi = createMatrix();

console.log(requests_by_period.toString());
