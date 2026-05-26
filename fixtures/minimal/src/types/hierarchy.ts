export interface Animal {
  species: string;
}

export interface Mammal extends Animal {
  warmBlooded: boolean;
}

export interface Pet {
  name: string;
}

export class Dog extends Mammal implements Pet {
  breed: string;
}
