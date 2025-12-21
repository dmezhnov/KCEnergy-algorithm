import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateTypeReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun.ts';
import { new_empty } from './matrix_operation';
import { CoordinateReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Coordinate.bun';

type Region = typeof Region;
const Region = CoordinateTypeReg['Region'];
type District = typeof District;
const District = CoordinateTypeReg['District'];
type Product_category = typeof Product_category;
const Product_category = CoordinateTypeReg['Product_category'];
type Product = typeof Product;
const Product = CoordinateTypeReg['Product'];
type Refinery = typeof Refinery;
const Refinery = CoordinateTypeReg['Refinery'];
type Market_participant = typeof Market_participant;
const Market_participant = CoordinateTypeReg['Market_participant'];
type Month_and_year = typeof Month_and_year;
const Month_and_year = CoordinateTypeReg['Month_and_year'];
type Queue = typeof Queue;
const Queue = CoordinateTypeReg['Queue'];

export type axis = keyof typeof axis;
export const axis = {
    Region,
    District,
    Product,
    Product_category,
    Refinery,
    Market_participant,
    Month_and_year,
    Queue
}

export type index<TAxis extends axis> = number & { __axis: TAxis };

export type coordinate<TAxis extends axis = axis> = {
    axis: TAxis,
    index: index<TAxis>
}

export const coordinate: coordinate<axis> = {} as coordinate<axis>;

export type Coordinate = {
    ai_92: coordinate<Product>,
    ai_920: coordinate<Product_category>,

    anpz: coordinate<Refinery>,
    pkop: coordinate<Refinery>,
    pnhz: coordinate<Refinery>,

    almaty: coordinate<Region>,
    almaty0: coordinate<District>,
    astana: coordinate<Region>,
    astana0: coordinate<District>,
    shymkent: coordinate<Region>,
    shymkent0: coordinate<District>,

    а: coordinate<Market_participant>,
    б: coordinate<Market_participant>,
    в: coordinate<Market_participant>,
    г: coordinate<Market_participant>,
    д: coordinate<Market_participant>,

    first: coordinate<Queue>,
    fourth: coordinate<Queue>,

    aug_2025: coordinate<Month_and_year>,
    jul_2025: coordinate<Month_and_year>,
    jun_2025: coordinate<Month_and_year>,
    may_2025: coordinate<Month_and_year>,
    apr_2025: coordinate<Month_and_year>,
    mar_2025: coordinate<Month_and_year>,
    feb_2025: coordinate<Month_and_year>,
    jan_2025: coordinate<Month_and_year>,
    dec_2024: coordinate<Month_and_year>,
    nov_2024: coordinate<Month_and_year>,
    oct_2024: coordinate<Month_and_year>,
    sep_2024: coordinate<Month_and_year>
}

export const Coordinate: Coordinate = {
    ai_92: CoordinateReg['BENZIN_AI_92'],
    ai_920: CoordinateReg['BENZIN_AI_92_0'],

    anpz: CoordinateReg['ANPZ'],
    pkop: CoordinateReg['PKOP'],
    pnhz: CoordinateReg['PNHZ'],

    almaty: CoordinateReg['Almaty'],
    almaty0: CoordinateReg['Almaty0'],
    astana: CoordinateReg['Astana'],
    astana0: CoordinateReg['Astana0'],
    shymkent: CoordinateReg['Shymkent'],
    shymkent0: CoordinateReg['Shymkent0'],

    а: CoordinateReg['«А.»'],
    б: CoordinateReg['«Б.»'],
    в: CoordinateReg['«В.»'],
    г: CoordinateReg['«Г.»'],
    д: CoordinateReg['«Е.»'],

    first: CoordinateReg['First'],
    fourth: CoordinateReg['Fourth'],

    aug_2025: CoordinateReg['aug_2025'],
    jul_2025: CoordinateReg['jul_2025'],
    jun_2025: CoordinateReg['jun_2025'],
    may_2025: CoordinateReg['may_2025'],
    apr_2025: CoordinateReg['apr_2025'],
    mar_2025: CoordinateReg['mar_2025'],
    feb_2025: CoordinateReg['feb_2025'],
    jan_2025: CoordinateReg['jan_2025'],
    dec_2024: CoordinateReg['dec_2024'],
    nov_2024: CoordinateReg['nov_2024'],
    oct_2024: CoordinateReg['oct_2024'],
    sep_2024: CoordinateReg['sep_2024']
}

export interface matrix<
    TAxes extends axis[] = axis[],
    TAxis extends axis = TAxes[number],
    TCoords extends coordinate<TAxis>[] = coordinate<TAxis>[],
    TCoordsNext extends coordinate<TAxis>[] = Exclude<TCoords[number], TCoords[number]>[],
    TAllCoords extends coordinate<TAxis>[] = TCoords | TCoordsNext
> extends MatrixBoi {
    (...coords: coordinate<TAxis>[]): matrix<TAxes>;
    coords: TCoords;
}

export const matrix = (
    <
        TAxes extends axis[] = axis[],
        TAxis extends axis = TAxes[number]
    >(...coords: coordinate<TAxis>[]): matrix<TAxes> => {
        return new_empty(...coords)
    }
) as unknown as matrix;



export default { axis, matrix, coordinate, Coordinate };
