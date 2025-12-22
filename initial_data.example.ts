import { matrix, Coordinate, coordinate } from './matrix_types'
const {
    ai_92,
    ai_920,

    ANPZ,
    PKOP,
    PNHZ,

    Almaty,
    Almaty0,
    Astana,
    Astana0,
    Shymkent,
    Shymkent0,

    а,
    б,
    в,
    г,
    д,

    First,
    Fourth,

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
    sep_2024,
} = Coordinate;

type MatrixAmount = { coordinates: coordinate[], amount: number };
type MatrixAmounts = MatrixAmount[];

const matrixFor = (matrix: matrix, callback: (el: matrix) => void) => {
    if (matrix.matrix_children['#количество'] > 0) {
        for (const el of matrix.matrix_children['#значение']) {
            matrixFor(el as matrix, callback);
        }
    } else {
        callback(matrix);
    }
}

const volumes_by_period_amounts: MatrixAmounts = [
    // 0001
    {
        coordinates: [ai_92, Astana, а, aug_2025],
        amount: 120
    },
    // 0002
    {
        coordinates: [ai_92, Almaty, а, aug_2025],
        amount: 100
    },
    // 0003
    {
        coordinates: [ai_92, Astana, а, jul_2025],
        amount: 120
    },
    // 0004
    {
        coordinates: [ai_92, Almaty, а, jul_2025],
        amount: 100
    },
    // 0005
    {
        coordinates: [ai_92, Astana, а, jun_2025],
        amount: 100
    },
    // 0006
    {
        coordinates: [ai_92, Almaty, а, jun_2025],
        amount: 100
    },
    // 0007
    {
        coordinates: [ai_92, Astana, а, may_2025],
        amount: 100
    },
    // 0008
    {
        coordinates: [ai_92, Almaty, а, may_2025],
        amount: 100
    },
    // 0009
    {
        coordinates: [ai_92, Astana, а, apr_2025],
        amount: 120
    },
    // 0010
    {
        coordinates: [ai_92, Almaty, а, apr_2025],
        amount: 90
    },
    // 0011
    {
        coordinates: [ai_92, Astana, а, mar_2025],
        amount: 80
    },
    // 0012
    {
        coordinates: [ai_92, Almaty, а, mar_2025],
        amount: 90
    },
    // 0013
    {
        coordinates: [ai_92, Astana, а, feb_2025],
        amount: 80
    },
    // 0014
    {
        coordinates: [ai_92, Almaty, а, feb_2025],
        amount: 80
    },
    // 0015
    {
        coordinates: [ai_92, Astana, а, jan_2025],
        amount: 80
    },
    // 0016
    {
        coordinates: [ai_92, Almaty, а, jan_2025],
        amount: 60
    },
    // 0017
    {
        coordinates: [ai_92, Astana, а, dec_2024],
        amount: 80
    },
    // 0018
    {
        coordinates: [ai_92, Almaty, а, dec_2024],
        amount: 0
    },
    // 0019
    {
        coordinates: [ai_92, Astana, а, nov_2024],
        amount: 80
    },
    // 0020
    {
        coordinates: [ai_92, Almaty, а, nov_2024],
        amount: 0
    },
    // 0021
    {
        coordinates: [ai_92, Astana, а, oct_2024],
        amount: 60
    },
    // 0022
    {
        coordinates: [ai_92, Almaty, а, oct_2024],
        amount: 0
    },
    // 0023
    {
        coordinates: [ai_92, Astana, а, sep_2024],
        amount: 60
    },
    // 0024
    {
        coordinates: [ai_92, Almaty, а, sep_2024],
        amount: 0
    },
    // 0025
    {
        coordinates: [ai_92, Shymkent, б, aug_2025],
        amount: 100
    },
    // 0026
    {
        coordinates: [ai_92, Shymkent, б, jul_2025],
        amount: 100
    },
    // 0027
    {
        coordinates: [ai_92, Shymkent, б, jun_2025],
        amount: 100
    },
    // 0028
    {
        coordinates: [ai_92, Shymkent, б, may_2025],
        amount: 100
    },
    // 0029
    {
        coordinates: [ai_92, Shymkent, б, apr_2025],
        amount: 90
    },
    // 0030
    {
        coordinates: [ai_92, Shymkent, б, mar_2025],
        amount: 90
    },
    // 0031
    {
        coordinates: [ai_92, Shymkent, б, feb_2025],
        amount: 80
    },
    // 0032
    {
        coordinates: [ai_92, Shymkent, б, jan_2025],
        amount: 60
    },
    // 0033
    {
        coordinates: [ai_92, Shymkent, б, dec_2024],
        amount: 0
    },
    // 0034
    {
        coordinates: [ai_92, Shymkent, б, nov_2024],
        amount: 0
    },
    // 0035
    {
        coordinates: [ai_92, Shymkent, б, oct_2024],
        amount: 0
    },
    // 0036
    {
        coordinates: [ai_92, Shymkent, б, sep_2024],
        amount: 0
    },
    // 0037
    {
        coordinates: [ai_92, Astana, в, aug_2025],
        amount: 120
    },
    // 0038
    {
        coordinates: [ai_92, Astana, в, jul_2025],
        amount: 120
    },
    // 0039
    {
        coordinates: [ai_92, Astana, в, jun_2025],
        amount: 100
    },
    // 0040
    {
        coordinates: [ai_92, Astana, в, may_2025],
        amount: 100
    },
    // 0041
    {
        coordinates: [ai_92, Astana, в, apr_2025],
        amount: 120
    },
    // 0042
    {
        coordinates: [ai_92, Astana, в, mar_2025],
        amount: 80
    },
    // 0043
    {
        coordinates: [ai_92, Astana, в, feb_2025],
        amount: 80
    },
    // 0044
    {
        coordinates: [ai_92, Astana, в, jan_2025],
        amount: 80
    },
    // 0045
    {
        coordinates: [ai_92, Astana, в, dec_2024],
        amount: 80
    },
    // 0046
    {
        coordinates: [ai_92, Astana, в, nov_2024],
        amount: 80
    },
    // 0047
    {
        coordinates: [ai_92, Astana, в, oct_2024],
        amount: 60
    },
    // 0048
    {
        coordinates: [ai_92, Astana, в, sep_2024],
        amount: 60
    }
]

const requests_by_period_ammounts: MatrixAmounts = [
    {
        coordinates: [
            ai_92,
            PKOP,
            Almaty,
            а,
            First
        ],
        amount: 100
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Astana,
            а,
            First
        ],
        amount: 150
    },
    {
        coordinates: [
            ai_92,
            ANPZ,
            Almaty,
            а,
            First
        ],
        amount: 40
    },
    {
        coordinates: [
            ai_92,
            PNHZ,
            Almaty,
            а,
            First
        ],
        amount: 60
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Shymkent,
            б,
            First
        ],
        amount: 300
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Astana,
            в,
            First
        ],
        amount: 200
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Almaty,
            г,
            First
        ],
        amount: 250
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Almaty,
            д,
            Fourth
        ],
        amount: 500
    },
    {
        coordinates: [
            ai_92,
            PKOP,
            Shymkent,
            г,
            First
        ],
        amount: 700
    }
]

const requestsEmptyMatrix: matrix = matrix(
    ai_92,
    PKOP,
    ANPZ,
    PNHZ,
    Almaty,
    Astana,
    Shymkent,
    а,
    б,
    в,
    г,
    д,
    First,
    Fourth
);

matrixFor(requestsEmptyMatrix, (el: matrix) => {
    const coords = el.coordinate_types['#значение'];

    requests_by_period_ammounts.forEach((ammount) => {
        const isMatch = ammount.coordinates.every((coord) => coords['содержит ли'](coord));

        if (isMatch) {
            el.amount['#значение'] = ammount.amount;
        }
    })
})


export const requests_by_period: matrix = requestsEmptyMatrix;

requests_by_period.print();

const volumesEmptyMatrix: matrix = matrix(
    ai_92,
    ai_920,
    Astana,
    Almaty,
    Shymkent,
    Astana0,
    Almaty0,
    Shymkent0,
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
);

matrixFor(volumesEmptyMatrix, (el: matrix) => {
    const coords = el.coordinate_types['#значение'];

    volumes_by_period_amounts.forEach((ammount) => {
        const isMatch = ammount.coordinates.every((coord) => coords['содержит ли'](coord));

        if (isMatch) {
            el.amount['#значение'] = ammount.amount;
        }
    })
})

export const volumes_by_period: matrix = volumesEmptyMatrix;

export const available_by_refinery: matrix = matrix();
