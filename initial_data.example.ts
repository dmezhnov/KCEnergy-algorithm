import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateReg, CoordinateBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Coordinate.bun';
import { MatrixOperationNewEmptyBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/MatrixOperationNewEmpty.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { Mouth_and_yearReg } from "lib/domen/kc-e.mybpm.kz/KCE/Группа/Системные справочники/Mouth_and_year.bun";

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

const ai_92 = CoordinateReg['BENZIN_AI_92'];
const ai_920 = CoordinateReg['BENZIN_AI_92_0'];

const anpz = CoordinateReg['ANPZ'];
const pkop = CoordinateReg['PKOP'];
const pnhz = CoordinateReg['PNHZ'];

const almaty = CoordinateReg['Almaty'];
const almaty0 = CoordinateReg['Almaty0'];
const astana = CoordinateReg['Astana'];
const astana0 = CoordinateReg['Astana0'];
const shymkent = CoordinateReg['Shymkent'];
const shymkent0 = CoordinateReg['Shymkent0'];

const а = CoordinateReg['«А.»'];
const б = CoordinateReg['«Б.»'];
const в = CoordinateReg['«В.»'];
const г = CoordinateReg['«Г.»'];
const д = CoordinateReg['«Е.»'];

const first = CoordinateReg['First'];
const fourth = CoordinateReg['Fourth'];

const aug_2025 = Mouth_and_yearReg['aug_2025'];
const jul_2025 = Mouth_and_yearReg['jul_2025'];
const jun_2025 = Mouth_and_yearReg['jun_2025'];
const may_2025 = Mouth_and_yearReg['may_2025'];
const apr_2025 = Mouth_and_yearReg['apr_2025'];
const mar_2025 = Mouth_and_yearReg['mar_2025'];
const feb_2025 = Mouth_and_yearReg['feb_2025'];
const jan_2025 = Mouth_and_yearReg['jan_2025'];
const dec_2024 = Mouth_and_yearReg['dec_2024'];
const nov_2024 = Mouth_and_yearReg['nov_2024'];
const oct_2024 = Mouth_and_yearReg['oct_2024'];
const sep_2024 = Mouth_and_yearReg['sep_2024'];

const volumes_by_period_amounts = [
    // 0001
    {
        coordinates: [ai_92, astana,а, aug_2025],
        amount: 120
    },
    // 0002
    {
        coordinates: [ai_92, almaty,а, aug_2025],
        amount: 100
    },
    // 0003
    {
        coordinates: [ai_92, astana,а, jul_2025],
        amount: 120
    },
    // 0004
    {
        coordinates: [ai_92, almaty,а, jul_2025],
        amount: 100
    },
    // 0005
    {
        coordinates: [ai_92, astana,а, jun_2025],
        amount: 100
    },
    // 0006
    {
        coordinates: [ai_92, almaty,а, jun_2025],
        amount: 100
    },
    // 0007
    {
        coordinates: [ai_92, astana,а, may_2025],
        amount: 100
    },
    // 0008
    {
        coordinates: [ai_92, almaty,а, may_2025],
        amount: 100
    },
    // 0009
    {
        coordinates: [ai_92, astana,а, apr_2025],
        amount: 120
    },
    // 0010
    {
        coordinates: [ai_92, almaty,а, apr_2025],
        amount: 90
    },
    // 0011
    {
        coordinates: [ai_92, astana,а, mar_2025],
        amount: 80
    },
    // 0012
    {
        coordinates: [ai_92, almaty,а, mar_2025],
        amount: 90
    },
    // 0013
    {
        coordinates: [ai_92, astana,а, feb_2025],
        amount: 80
    },
    // 0014
    {
        coordinates: [ai_92, almaty,а, feb_2025],
        amount: 80
    },
    // 0015
    {
        coordinates: [ai_92, astana,а, jan_2025],
        amount: 80
    },
    // 0016
    {
        coordinates: [ai_92, almaty,а, jan_2025],
        amount: 60
    },
    // 0017
    {
        coordinates: [ai_92, astana,а, dec_2024],
        amount: 80
    },
    // 0018
    {
        coordinates: [ai_92, almaty,а, dec_2024],
        amount: 0
    },
    // 0019
    {
        coordinates: [ai_92, astana,а, nov_2024],
        amount: 80
    },
    // 0020
    {
        coordinates: [ai_92, almaty,а, nov_2024],
        amount: 0
    },
    // 0021
    {
        coordinates: [ai_92, astana,а, oct_2024],
        amount: 60
    },
    // 0022
    {
        coordinates: [ai_92, almaty,а, oct_2024],
        amount: 0
    },
    // 0023
    {
        coordinates: [ai_92, astana,а, sep_2024],
        amount: 60
    },
    // 0024
    {
        coordinates: [ai_92, almaty,а, sep_2024],
        amount: 0
    },
    // 0025
    {
        coordinates: [ai_92, shymkent,б, aug_2025],
        amount: 100
    },
    // 0026
    {
        coordinates: [ai_92, shymkent,б, jul_2025],
        amount: 100
    },
    // 0027
    {
        coordinates: [ai_92, shymkent,б, jun_2025],
        amount: 100
    },
    // 0028
    {
        coordinates: [ai_92, shymkent,б, may_2025],
        amount: 100
    },
    // 0029
    {
        coordinates: [ai_92, shymkent,б, apr_2025],
        amount: 90
    },
    // 0030
    {
        coordinates: [ai_92, shymkent,б, mar_2025],
        amount: 90
    },
    // 0031
    {
        coordinates: [ai_92, shymkent,б, feb_2025],
        amount: 80
    },
    // 0032
    {
        coordinates: [ai_92, shymkent,б, jan_2025],
        amount: 60
    },
    // 0033
    {
        coordinates: [ai_92, shymkent,б, dec_2024],
        amount: 0
    },
    // 0034
    {
        coordinates: [ai_92, shymkent,б, nov_2024],
        amount: 0
    },
    // 0035
    {
        coordinates: [ai_92, shymkent,б, oct_2024],
        amount: 0
    },
    // 0036
    {
        coordinates: [ai_92, shymkent,б, sep_2024],
        amount: 0
    },
    // 0037
    {
        coordinates: [ai_92, astana,в, aug_2025],
        amount: 120
    },
    // 0038
    {
        coordinates: [ai_92, astana,в, jul_2025],
        amount: 120
    },
    // 0039
    {
        coordinates: [ai_92, astana,в, jun_2025],
        amount: 100
    },
    // 0040
    {
        coordinates: [ai_92, astana,в, may_2025],
        amount: 100
    },
    // 0041
    {
        coordinates: [ai_92, astana,в, apr_2025],
        amount: 120
    },
    // 0042
    {
        coordinates: [ai_92, astana,в, mar_2025],
        amount: 80
    },
    // 0043
    {
        coordinates: [ai_92, astana,в, feb_2025],
        amount: 80
    },
    // 0044
    {
        coordinates: [ai_92, astana,в, jan_2025],
        amount: 80
    },
    // 0045
    {
        coordinates: [ai_92, astana,в, dec_2024],
        amount: 80
    },
    // 0046
    {
        coordinates: [ai_92, astana,в, nov_2024],
        amount: 80
    },
    // 0047
    {
        coordinates: [ai_92, astana,в, oct_2024],
        amount: 60
    },
    // 0048
    {
        coordinates: [ai_92, astana,в, sep_2024],
        amount: 60
    }
]

const requestsEmptyMatrixOper = new MatrixOperationNewEmptyBoi();
requestsEmptyMatrixOper.coordinates_input_1['#значение'] = arrayToScratchFormat([
    ai_92,
    anpz,
    pkop,
    pnhz,
    almaty,
    astana,
    shymkent,
    а,
    б,
    в,
    г,
    д,
    first,
    fourth
])

const requests_by_period_ammounts = [
    {
        coordinates: [
            ai_92,
            pkop,
            almaty,
            а,
            first
        ],
        amount: 100
    },
    {
        coordinates: [
            ai_92,
            pkop,
            astana,
            а,
            first
        ],
        amount: 150
    },
    {
        coordinates: [
            ai_92,
            anpz,
            almaty,
            а,
            first
        ],
        amount: 40
    },
    {
        coordinates: [
            ai_92,
            pnhz,
            almaty,
            а,
            first
        ],
        amount: 60
    },
    {
        coordinates: [
            ai_92,
            pkop,
            shymkent,
            б,
            first
        ],
        amount: 300
    },
    {
        coordinates: [
            ai_92,
            pkop,
            astana,
            б,
            first
        ],
        amount: 200
    },
    {
        coordinates: [
            ai_92,
            pkop,
            almaty,
            в,
            fourth
        ],
        amount: 250
    },
    {
        coordinates: [
            ai_92,
            pkop,
            almaty,
            в,
            fourth
        ],
        amount: 500
    },
    {
        coordinates: [
            ai_92,
            pkop,
            shymkent,
            г,
            first
        ],
        amount: 700
    }
]

await requestsEmptyMatrixOper['#Запустить процесс']();

const requestsEmptyMatrix: MatrixBoi = requestsEmptyMatrixOper.matrix_output_1['#значение'] as MatrixBoi;

matrixFor(requestsEmptyMatrix, (el: MatrixBoi) => {
    const coords = el.coordinate_types['#значение'];

    requests_by_period_ammounts.forEach((ammount) => {
        const isMatch = ammount.coordinates.every((coord) => coords['содержит ли'](coord));

        if (isMatch) {
            el.amount['#значение'] = ammount.amount;
        }
    })
})


export const requests_by_period: MatrixBoi = requestsEmptyMatrix;

const volumesEmptyMatrixOper = new MatrixOperationNewEmptyBoi();
volumesEmptyMatrixOper.coordinates_input_1['#значение'] = arrayToScratchFormat([
    ai_92,
    ai_920,
    astana,
    almaty,
    shymkent,
    astana0,
    almaty0,
    shymkent0,
    а,
    б,
    в,
    aug_2025,
    jul_2025,
    jun_2025,
    may_2025,
    apr_2025,
    mar_2025,
    feb_2025,
    jan_2025,
    dec_2024,
    nov_2024,
    oct_2024,
    sep_2024
]);

await volumesEmptyMatrixOper['#Запустить процесс']();

const volumesEmptyMatrix: MatrixBoi = volumesEmptyMatrixOper.matrix_output_1['#значение'] as MatrixBoi;

matrixFor(volumesEmptyMatrix, (el: MatrixBoi) => {
    const coords = el.coordinate_types['#значение'];

    volumes_by_period_amounts.forEach((ammount) => {
        const isMatch = ammount.coordinates.every((coord) => coords['содержит ли'](coord));

        if (isMatch) {
            el.amount['#значение'] = ammount.amount;
        }
    })
})

export const volumes_by_period: MatrixBoi = volumesEmptyMatrix;

export const available_by_refinery: MatrixBoi = new MatrixBoi();
