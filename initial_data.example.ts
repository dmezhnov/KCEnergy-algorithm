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

const matrixFor = (matrix: MatrixBoi, callback: (el: MatrixBoi) => void) => {
    if(matrix.matrix_children['#количество'] > 0) {
        for (const el of matrix.matrix_children['#значение']){
            matrixFor(el as MatrixBoi, callback);
        }
    } else {
        callback(matrix);
    }
}

const ai_92 = CoordinateReg['BENZIN_AI_92'];
const anpz = CoordinateReg['ANPZ'];
const pkop = CoordinateReg['PKOP'];
const pnhz = CoordinateReg['PNHZ'];
const almaty = CoordinateReg['Almaty'];
const astana = CoordinateReg['Astana'];
const shymkent = CoordinateReg['Shymkent'];
const a = CoordinateReg['«А.»'];
const b = CoordinateReg['«Б.»'];
const v = CoordinateReg['«В.»'];
const g = CoordinateReg['«Г.»'];
const d = CoordinateReg['«Д.»'];
const e = CoordinateReg['«Е.»'];
const first = CoordinateReg['First'];
const fourth = CoordinateReg['Fourth'];

const newEmptyMAtrixOper = new MatrixOperationNewEmptyBoi();
newEmptyMAtrixOper.coordinates_input_1['#значение'] = arrayToScratchFormat([
    ai_92,
    anpz,
    pkop,
    pnhz,
    almaty,
    astana,
    shymkent,
    a,
    b,
    v,
    g,
    d,
    e,
    first,
    fourth
])

const ammounts = [
    {
        coordinates: [
            ai_92,
            pkop,
            almaty,
            a,
            first
        ],
        amount: 100
    }
]

await newEmptyMAtrixOper['#Запустить процесс']();

const newEmptyMatrix: MatrixBoi = newEmptyMAtrixOper.matrix_output_1['#значение'] as MatrixBoi;

matrixFor(newEmptyMatrix, (el: MatrixBoi) => {
    const coords = el.coordinate_types['#значение'];

    ammounts.forEach((ammount) => {
        const isMatch = ammount.coordinates.every((coord) => coords['содержит ли'](coord));

        if (isMatch) {
            el.amount['#значение'] = ammount.amount;
        }
    })
})


export const requests_by_period: MatrixBoi = newEmptyMatrix;

export const volumes_by_period: MatrixBoi = createMatrix();

export const available_by_refinery: MatrixBoi = createMatrix();
