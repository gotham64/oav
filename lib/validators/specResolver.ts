import * as _ from 'lodash'
import * as path from 'path'
import * as JsonRefs from 'json-refs'
import * as utils from '../util/utils'
import { Constants } from '../util/constants'
import { log } from '../util/logging'

let ErrorCodes = Constants.ErrorCodes

export interface Options
{
  shouldResolveRelativePaths?: boolean
  shouldResolveXmsExamples?: boolean
  shouldResolveAllOf?: boolean
  shouldSetAdditionalPropertiesFalse?: boolean
  shouldResolvePureObjects?: boolean
  shouldResolveDiscriminator?: boolean
  shouldResolveParameterizedHost?: boolean
  shouldResolveNullableTypes?: boolean
  shouldModelImplicitDefaultResponse?: boolean
}

/**
 * @class
 * Resolves the swagger spec by unifying x-ms-paths, resolving relative file references if any,
 * resolving the allof is present in any model definition and then setting additionalProperties
 * to false if it is not previously set to true or an object in that definition.
 */
export class SpecResolver {

  specInJson: any

  specPath: string

  specDir: any

  visitedEntities: any

  resolvedAllOfModels: any

  options: Options

  /**
   * @constructor
   * Initializes a new instance of the SpecResolver class.
   *
   * @param {string} specPath the (remote|local) swagger spec path
   *
   * @param {object} specInJson the parsed spec in json format
   *
   * @param {object} [options] The options object
   *
   * @param {object} [options.shouldResolveRelativePaths] Should relative pathes be resolved? Default: true
   *
   * @param {object} [options.shouldResolveXmsExamples] Should x-ms-examples be resolved? Default: true.
   * If options.shouldResolveRelativePaths is false then this option will also be false implicitly and cannot be overridden.
   *
   * @param {object} [options.shouldResolveAllOf] Should allOf references be resolved? Default: true
   *
   * @param {object} [options.shouldResolveDiscriminator] Should discriminator be resolved? Default: true
   *
   * @param {object} [options.shouldSetAdditionalPropertiesFalse] Should additionalProperties be set to false? Default: true
   *
   * @param {object} [options.shouldResolvePureObjects] Should pure objects be resolved? Default: true
   *
   * @param {object} [options.shouldResolveParameterizedHost] Should x-ms-parameterized-host be resolved? Default: true
   *
   * @param {object} [options.shouldResolveNullableTypes] Should we allow null values to match any type? Default: true
   *
   * @param {object} [options.shouldModelImplicitDefaultResponse] Should we model a default response even if it is not defined? Default: false
   *
   * @return {object} An instance of the SpecResolver class.
   */
  constructor(specPath: string, specInJson: any, options: Options) {
    if (specPath === null
      || specPath === undefined
      || typeof specPath.valueOf() !== 'string'
      || !specPath.trim().length) {
      throw new Error('specPath is a required property of type string and it cannot be an empty string.')
    }

    if (specInJson === null || specInJson === undefined || typeof specInJson !== 'object') {
      throw new Error('specInJson is a required property of type object')
    }
    this.specInJson = specInJson
    this.specPath = specPath
    this.specDir = path.dirname(this.specPath)
    this.visitedEntities = {}
    this.resolvedAllOfModels = {}
    if (!options) options = {}
    if (options.shouldResolveRelativePaths === null || options.shouldResolveRelativePaths === undefined) {
      options.shouldResolveRelativePaths = true
    }
    if (options.shouldResolveXmsExamples === null || options.shouldResolveXmsExamples === undefined) {
      options.shouldResolveXmsExamples = true
    }
    if (options.shouldResolveAllOf === null || options.shouldResolveAllOf === undefined) {
      if (!_.isUndefined(specInJson.definitions)) {
        options.shouldResolveAllOf = true
      }
    }
    if (options.shouldSetAdditionalPropertiesFalse === null
      || options.shouldSetAdditionalPropertiesFalse === undefined) {
      options.shouldSetAdditionalPropertiesFalse = options.shouldResolveAllOf
    }
    if (options.shouldResolvePureObjects === null || options.shouldResolvePureObjects === undefined) {
      options.shouldResolvePureObjects = true
    }
    if (options.shouldResolveDiscriminator === null || options.shouldResolveDiscriminator === undefined) {
      options.shouldResolveDiscriminator = options.shouldResolveAllOf
    }
    if (options.shouldResolveParameterizedHost === null || options.shouldResolveParameterizedHost === undefined) {
      options.shouldResolveParameterizedHost = true
    }
    // Resolving allOf is a neccessary precondition for resolving discriminators. Hence hard setting this to true
    if (options.shouldResolveDiscriminator) {
      options.shouldResolveAllOf = true
    }
    if (options.shouldResolveNullableTypes === null || options.shouldResolveNullableTypes === undefined) {
      options.shouldResolveNullableTypes = options.shouldResolveAllOf
    }
    if (options.shouldModelImplicitDefaultResponse === null
      || options.shouldModelImplicitDefaultResponse === undefined) {
      options.shouldModelImplicitDefaultResponse = false
    }
    this.options = options
  }

  /**
   * Merges the x-ms-paths object into the paths object in swagger spec. The method assumes that the
   * paths present in "x-ms-paths" and "paths" are unique. Hence it does a simple union.
   */
  async unifyXmsPaths(): Promise<this> {
    //unify x-ms-paths into paths
    let xmsPaths = this.specInJson['x-ms-paths']
    let paths = this.specInJson.paths
    if (xmsPaths && xmsPaths instanceof Object && utils.getKeys(xmsPaths).length > 0) {
      for (const property of utils.getKeys(xmsPaths)) {
        paths[property] = xmsPaths[property]
      }
      this.specInJson.paths = utils.mergeObjects(xmsPaths, paths)
    }
    return this
  }

  /**
   * Resolves the swagger spec by unifying x-ms-paths, resolving relative file references if any,
   * resolving the allof is present in any model definition and then setting additionalProperties
   * to false if it is not previously set to true or an object in that definition.
   */
  async resolve(): Promise<any> {
    let self = this
    return self.unifyXmsPaths().then(() => {
      if (self.options.shouldResolveRelativePaths) {
        return self.resolveRelativePaths()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolveAllOf) {
        return self.resolveAllOfInDefinitions()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolveDiscriminator) {
        return self.resolveDiscriminator()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolveAllOf) {
        return self.deleteReferencesToAllOf()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldSetAdditionalPropertiesFalse) {
        return self.setAdditionalPropertiesFalse()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolveParameterizedHost) {
        return self.resolveParameterizedHost()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolvePureObjects) {
        return self.resolvePureObjects()
      } else {
        return Promise.resolve(self)
      }
    }).then(() => {
      if (self.options.shouldResolveNullableTypes) {
        return self.resolveNullableTypes()
      } else {
        return Promise.resolve(self)
      }
    }).then((): any => {
      if (self.options.shouldModelImplicitDefaultResponse) {
        return self.modelImplicitDefaultResponse()
      } else {
        return Promise.resolve(self)
      }
    }).catch((err: any) => {
      let e = {
        message: `An Error occurred while resolving relative references and allOf in model definitions in the swagger spec: "${self.specPath}".`,
        code: ErrorCodes.ResolveSpecError.name,
        id: ErrorCodes.ResolveSpecError.id,
        innerErrors: [err]
      }
      log.error(err)
      return Promise.reject(e)
    });
  }

  /**
   * Resolves the references to relative paths in the provided object.
   *
   * @param {object} [doc] the json doc that contains relative references. Default: self.specInJson (current swagger spec).
   *
   * @param {string} [docPath] the absolute (local|remote) path of the doc Default: self.specPath (current swagger spec path).
   *
   * @param {string} [filterType] the type of paths to filter. By default the method will resolve 'relative' and 'remote' references.
   * If provided the value should be 'all'. This indicates that 'local' references should also be resolved apart from the default ones.
   *
   * @return {object} doc fully resolved json document
   */
  async resolveRelativePaths(doc?: any, docPath?: string, filterType?: string): Promise<any> {
    let self = this
    let docDir
    let options = {
      relativeBase: docDir,
      filter: ['relative', 'remote']
    }

    if (!doc) {
      doc = self.specInJson
    }
    if (!docPath) {
      docPath = self.specPath
      docDir = self.specDir
    }
    if (!docDir) {
      docDir = path.dirname(docPath)
    }
    if (filterType === 'all') {
      delete options.filter
    }

    let allRefsRemoteRelative = JsonRefs.findRefs(doc, options)
    let promiseFactories = utils.getKeys(allRefsRemoteRelative).map((refName: any) => {
      let refDetails = allRefsRemoteRelative[refName]
      return () => { return self.resolveRelativeReference(refName, refDetails, doc, docPath) }
    });
    if (promiseFactories.length) {
      return await utils.executePromisesSequentially(promiseFactories)
    } else {
      return doc
    }
  }

  /**
   * Resolves the relative reference in the provided object. If the object to be resolved contains
   * more relative references then this method will call resolveRelativePaths
   *
   * @param {string} refName the reference name/location that has a relative reference
   *
   * @param {object} refDetails the value or the object that the refName points at
   *
   * @param {object} doc the doc in which the refName exists
   *
   * @param {string} docPath the absolute (local|remote) path of the doc
   *
   * @return undefined the modified object
   */
  async resolveRelativeReference(refName: string, refDetails: any, doc: any, docPath: string|undefined): Promise<any> {
    if (!refName || (refName && typeof refName.valueOf() !== 'string')) {
      throw new Error('refName cannot be null or undefined and must be of type "string".')
    }

    if (!refDetails || (refDetails && !(refDetails instanceof Object))) {
      throw new Error('refDetails cannot be null or undefined and must be of type "object".')
    }

    if (!doc || (doc && !(doc instanceof Object))) {
      throw new Error('doc cannot be null or undefined and must be of type "object".')
    }

    if (!docPath || (docPath && typeof docPath.valueOf() !== 'string')) {
      throw new Error('docPath cannot be null or undefined and must be of type "string".')
    }

    let self = this
    let node = refDetails.def
    let slicedRefName = refName.slice(1)
    let reference = node['$ref']
    let parsedReference = utils.parseReferenceInSwagger(reference)
    let docDir = path.dirname(docPath)

    if (parsedReference.filePath) {
      //assuming that everything in the spec is relative to it, let us join the spec directory
      //and the file path in reference.
      docPath = utils.joinPath(docDir, parsedReference.filePath)
    }

    const result = await utils.parseJson(docPath)
    if (!parsedReference.localReference) {
      //Since there is no local reference we will replace the key in the object with the parsed
      //json (relative) file it is refering to.
      let regex = /.*x-ms-examples.*/ig
      if (self.options.shouldResolveXmsExamples
        || (!self.options.shouldResolveXmsExamples && slicedRefName.match(regex) === null)) {
        utils.setObject(doc, slicedRefName, result)
      }
      return doc
    } else {
      //resolve the local reference.
      //make the reference local to the doc being processed
      node['$ref'] = parsedReference.localReference.value
      utils.setObject(doc, slicedRefName, node)
      let slicedLocalReferenceValue = parsedReference.localReference.value.slice(1)
      let referencedObj = self.visitedEntities[slicedLocalReferenceValue]
      if (!referencedObj) {
        //We get the definition/parameter from the relative file and then add it (make it local)
        //to the doc (i.e. self.specInJson) being processed.
        referencedObj = utils.getObject(result, slicedLocalReferenceValue)
        utils.setObject(self.specInJson, slicedLocalReferenceValue, referencedObj)
        self.visitedEntities[slicedLocalReferenceValue] = referencedObj
        await self.resolveRelativePaths(referencedObj, docPath, 'all')
        //After resolving a model definition, if there are models that have an allOf on that model definition
        //It may be possible that those models are not being referenced anywhere. Hence, we must ensure
        //that they are consumed as well. Example model "CopyActivity" in file
        //arm-datafactory/2017-03-01-preview/swagger/entityTypes/Pipeline.json is having an allOf on model
        //"Activity". Spec "datafactory.json" has references to "Activity" in Pipeline.json but there are no
        //references to "CopyActivity". The following code, ensures that we do not forget such models while
        //resolving relative swaggers.
        if (result && result.definitions) {
          const unresolvedDefinitions: (() => Promise<void>)[] = []

          function processDefinition(defName: string) {
            unresolvedDefinitions.push(async () => {
              if (result.definitions[defName].allOf) {
                const matchFound = result.definitions[defName].allOf.some((item: any) => {
                  return (!self.visitedEntities[`/definitions/${defName}`])
                })
                if (matchFound) {
                  const slicedDefinitionRef = `/definitions/${defName}`
                  const definitionObj = result.definitions[defName]
                  utils.setObject(self.specInJson, slicedDefinitionRef, definitionObj)
                  self.visitedEntities[slicedDefinitionRef] = definitionObj
                  await self.resolveRelativePaths(definitionObj, docPath, 'all')
                }
              }
            })
          }

          for (const defName of utils.getKeys(result.definitions)) {
            processDefinition(defName)
          }

          return await utils.executePromisesSequentially(unresolvedDefinitions)
        }
        return
      } else {
        return doc
      }
    }
  }

  /**
   * Resolves the "allOf" array present in swagger model definitions by composing all the properties of the parent model into the child model.
   */
  async resolveAllOfInDefinitions(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions
    const modelNames = utils.getKeys(definitions)
    modelNames.map(modelName => {
      const model = definitions[modelName]
      const modelRef = '/definitions/' + modelName
      return self.resolveAllOfInModel(model, modelRef)
    })
    return self
  }

  /**
   * Resolves the "allOf" array present in swagger model definitions by composing all the properties of the parent model into the child model.
   */
  resolveAllOfInModel(model: any, modelRef: any) {
    let self = this
    let spec = self.specInJson
    if (!model || (model && typeof model !== 'object')) {
      throw new Error(`model cannot be null or undefined and must of type "object".`)
    }

    if (!modelRef || (modelRef && typeof modelRef.valueOf() !== 'string')) {
      throw new Error(`model cannot be null or undefined and must of type "string".`)
    }

    if (modelRef.startsWith('#')) modelRef = modelRef.slice(1)

    if (!self.resolvedAllOfModels[modelRef]) {
      if (model && model.allOf) {
        model.allOf.map((item: any) => {
          let referencedModel = item
          let ref = item['$ref']
          let slicedRef = ref ? ref.slice(1) : undefined
          if (ref) {
            referencedModel = utils.getObject(spec, slicedRef)
          }
          if (referencedModel.allOf) {
            self.resolveAllOfInModel(referencedModel, slicedRef)
          }
          model = self.mergeParentAllOfInChild(referencedModel, model)
          self.resolvedAllOfModels[slicedRef] = referencedModel
          return model
        })
      } else {
        self.resolvedAllOfModels[modelRef] = model
        return model
      }
    }
  }

  /**
   * Merges the properties of the parent model into the child model.
   *
   * @param {object} parent object to be merged. Example: "Resource".
   *
   * @param {object} child object to be merged. Example: "Storage".
   *
   * @return {object} returns the merged child oject
   */
  mergeParentAllOfInChild(parent: any, child: any) {
    let self = this
    if (!parent || (parent && typeof parent !== 'object')) {
      throw new Error(`parent must be of type "object".`)
    }
    if (!child || (child && typeof child !== 'object')) {
      throw new Error(`child must be of type "object".`)
    }
    //merge the parent (Resource) model's properties into the properties
    //of the child (StorageAccount) model.
    if (!parent.properties) parent.properties = {}
    if (!child.properties) child.properties = {}
    child.properties = utils.mergeObjects(parent.properties, child.properties)
    //merge the array of required properties
    if (parent.required) {
      if (!child.required) {
        child.required = []
      }
      child.required = [...new Set([...parent.required, ...child.required])]
    }
    //merge x-ms-azure-resource
    if (parent['x-ms-azure-resource']) {
      child['x-ms-azure-resource'] = parent['x-ms-azure-resource']
    }
    return child
  }

  /**
   * Deletes all the references to allOf from all the model definitions in the swagger spec.
   */
  async deleteReferencesToAllOf(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions
    const modelNames = utils.getKeys(definitions)
    modelNames.map(modelName => {
      if (definitions[modelName].allOf) {
        delete definitions[modelName].allOf
      }
    })
    return self
  }

  /*
   * Sets additionalProperties of the given modelNames to false.
   *
   * @param {array} [modelNames] An array of strings that specifies the modelNames to be processed.
   * Default: All the modelnames from the definitions section in the swagger spec.
   *
   * @param {boolean} [force] A boolean value that indicates whether to ignore the additionalProperties
   * set to true or an object and forcefully set it to false. Default: false.
   */
  async setAdditionalPropertiesFalse(modelNames?: any[], force?: boolean): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions

    if (!modelNames) {
      modelNames = utils.getKeys(definitions)
    }
    modelNames.forEach(modelName => {
      let model = definitions[modelName]
      if (model) {
        if (force
          || (!model.additionalProperties
            && (!(!model.properties || (model.properties && utils.getKeys(model.properties).length === 0))))) {
          model.additionalProperties = false
        }
      }
    })
    return self
  }

  /**
   * Resolves the parameters provided in 'x-ms-parameterized-host'
   * extension by adding those parameters as local parameters to every operation.
   *
   * ModelValidation:
   * This step should only be performed for model validation as we need to
   * make sure that the examples contain correct values for parameters
   * defined in 'x-ms-parameterized-host'.hostTemplate. Moreover, they are a
   * part of the baseUrl.
   *
   * SemanticValidation:
   * This step should not be performed for semantic validation, othwerise there will
   * be a mismatch between the number of path parameters provided in the operation
   * definition and the number of parameters actually present in the path template.
   */
  async resolveParameterizedHost(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const parameterizedHost = spec[Constants.xmsParameterizedHost]
    const hostParameters = parameterizedHost ? parameterizedHost.parameters : null
    if (parameterizedHost && hostParameters) {
      const paths = spec.paths
      for (const verbs of utils.getValues(paths)) {
        for (const operation of utils.getValues(verbs)) {
          let operationParameters = operation.parameters
          if (!operationParameters) operationParameters = []
          // merge host parameters into parameters for that operation.
          operation.parameters = operationParameters.concat(hostParameters)
        }
      }
    }

    return self
  }

  /**
   * Resolves entities (parameters, definitions, model properties, etc.) in the spec that are true ojects.
   * i.e `"type": "object"` and `"properties": {}` or `"properties"` is absent or the entity has
   * "additionalProperties": { "type": "object" }.
   */
  async resolvePureObjects(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions

    //scan definitions and properties of every model in definitions
    for (let model of utils.getValues(definitions)) {
      utils.relaxModelLikeEntities(model)
    }

    const resolveOperation = (operation: any) => {
      //scan every parameter in the operation
      let consumes = _.isUndefined(operation.consumes) ?
        _.isUndefined(spec.consumes) ?
          ['application/json']
          : spec.consumes
        : operation.consumes

      let produces = _.isUndefined(operation.produces) ?
        _.isUndefined(spec.produces) ?
          ['application/json']
          : spec.produces
        : operation.produces

      let octetStream = (elements: any) => {
        return elements.some((e: any) => {
          return e.toLowerCase() === 'application/octet-stream'
        })
      }

      let resolveParameter = (param: any) => {
        if (param.in && param.in === 'body' && param.schema && !octetStream(consumes)) {
          param.schema = utils.relaxModelLikeEntities(param.schema)
        } else {
          param = utils.relaxEntityType(param, param.required)
        }
      }

      if (operation.parameters) {
        operation.parameters.forEach(resolveParameter)
      }
      //scan every response in the operation
      if (operation.responses) {
        for (let response of utils.getValues(operation.responses)) {
          if (response.schema && !octetStream(produces)) {
            response.schema = utils.relaxModelLikeEntities(response.schema)
          }
        }
      }
    }

    const resolveParameter = (param: any) => {
      if (param.in && param.in === 'body' && param.schema) {
        param.schema = utils.relaxModelLikeEntities(param.schema)
      } else {
        param = utils.relaxEntityType(param, param.required)
      }
    }

    //scan every operation
    for (const pathObj of utils.getValues(spec.paths)) {
      for (const operation of utils.getValues(pathObj)) {
        resolveOperation(operation)
      }
      //scan path level parameters if any
      if (pathObj.parameters) {
        pathObj.parameters.forEach(resolveParameter)
      }
    }
    //scan global parameters
    for (const param of utils.getKeys(spec.parameters)) {
      if (spec.parameters[param].in && spec.parameters[param].in === 'body' && spec.parameters[param].schema) {
        spec.parameters[param].schema = utils.relaxModelLikeEntities(spec.parameters[param].schema)
      }
      spec.parameters[param] = utils.relaxEntityType(spec.parameters[param], spec.parameters[param].required)
    }
    return self
  }

  /**
   * Models a default response as a Cloud Error if none is specified in the api spec.
   */
  modelImplicitDefaultResponse(): void {
    const self = this
    const spec = self.specInJson
    if (!spec.definitions.CloudError) {
      spec.definitions.CloudErrorWrapper = utils.CloudErrorWrapper
      spec.definitions.CloudError = utils.CloudError
    }
    for (const pathObj of utils.getValues(spec.paths)) {
      for (const operation of utils.getValues(pathObj)) {

        if (operation.responses && !operation.responses.default) {
          operation.responses.default = utils.CloudErrorSchema
        }
      }
    }
  }

  /**
   * Resolves the discriminator by replacing all the references to the parent model with a oneOf array containing
   * references to the parent model and all its child models. It also modifies the discriminator property in
   * the child models by making it a constant (enum with one value) with the value expected for that model
   * type on the wire.
   * For example: There is a model named "Animal" with a discriminator as "animalType". Models like "Cat", "Dog",
   * "Tiger" are children (having "allof": [ { "$ref": "#/definitions/Animal" } ] on) of "Animal" in the swagger spec.
   *
   * - This method will replace all the locations in the swagger spec that have a reference to the
   * parent model "Animal" ("$ref": "#/definitions/Animal") except the allOf reference with a oneOf reference
   * "oneOf": [ { "$ref": "#/definitions/Animal" }, { "$ref": "#/definitions/Cat" }, { "$ref": "#/definitions/Dog" }, { "$ref": "#/definitions/Tiger" } ]
   *
   * - It will also add a constant value (name of that animal on the wire or the value provided by "x-ms-discriminator-value")
   * to the discrimiantor property "animalType" for each of the child models.
   * For example:  the Cat model's discriminator property will look like:
   * "Cat": { "required": [ "animalType" ], "properties": { "animalType": { "type": "string", "enum": [ "Cat" ] },  . . } }.
   */
  async resolveDiscriminator(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions
    const modelNames = utils.getKeys(definitions)
    const subTreeMap = new Map()
    const references = JsonRefs.findRefs(spec)

    modelNames.map((modelName) => {
      if (definitions[modelName].discriminator) {
        let rootNode = subTreeMap.get(modelName)
        if (!rootNode) {
          rootNode = self.createPolymorphicTree(modelName, definitions[modelName].discriminator, subTreeMap)
        }
        self.updateReferencesWithOneOf(subTreeMap, references)
      }
    })

    return self
  }

  /**
   * Resolves all properties in models or responses that have a "type" defined, so that if the property
   * is marked with "x-nullable", we'd honor it: we'd relax the type to include "null" if value is true, we won't if value is false.
   * If the property does not have the "x-nullable" extension, then if not required, we'll relax the type to include "null"; if required we won't.
   * The way we're relaxing the type is to have the model be a "oneOf" array with one value being the original content of the model and the second value "type": "null".
   */
  resolveNullableTypes(): Promise<this> {
    const self = this
    const spec = self.specInJson
    const definitions = spec.definitions

    //scan definitions and properties of every model in definitions
    for (const defName of utils.getKeys(definitions)) {
      const model = definitions[defName]
      definitions[defName] = utils.allowNullableTypes(model)
    }
    //scan every operation response
    for (const pathObj of utils.getValues(spec.paths)) {
      //need to handle paramaters at this level
      if (pathObj.parameters) {
        for (let parameter of utils.getKeys(pathObj.parameters)) {
          pathObj.parameters[parameter] = utils.allowNullableParams(pathObj.parameters[parameter])
        }
      }
      for (const operation of utils.getValues(pathObj)) {
        // need to account for parameters, except for path parameters
        if (operation.parameters) {
          for (let parameter of utils.getKeys(operation.parameters)) {
            operation.parameters[parameter] = utils.allowNullableParams(operation.parameters[parameter])
          }
        }
        // going through responses
        if (operation.responses) {
          for (let response of utils.getValues(operation.responses)) {
            if (response.schema) {
              response.schema = utils.allowNullableTypes(response.schema)
            }
          }
        }
      }
    }

    // scan parameter definitions
    for (const parameter of utils.getKeys(spec.parameters)) {
      spec.parameters[parameter] = utils.allowNullableParams(spec.parameters[parameter])
    }

    return Promise.resolve(self)
  }

  /**
   * Updates the reference to a parent node with a oneOf array containing a reference to the parent and all its children.
   *
   * @param {Map<string, PolymorphicTree>} subTreeMap - A map containing a reference to a node in the PolymorhicTree.
   * @param {object} references - This object is the output of findRefs function from "json-refs" library. Please refer
   * to the documentation of json-refs over [here](https://github.com/whitlockjc/json-refs/blob/master/docs/API.md#jsonrefsunresolvedrefdetails--object)
   * for detailed structure of the object.
   */
  updateReferencesWithOneOf(subTreeMap: Map<string, PolymorphicTree>, references: any): void {
    const spec = this.specInJson

    for (const node of subTreeMap.values()) {
      // Have to process all the non-leaf nodes only
      if (node.children.size > 0) {
        const locationsToBeUpdated = []
        const modelReference = `#/definitions/${node.name}`
        // Create a list of all the locations where the current node is referenced
        for (const key in references) {
          if (references[key].uri === modelReference
            && key.indexOf("allOf") === -1
            && key.indexOf("oneOf") === -1)
            locationsToBeUpdated.push(key)
        }
        // Replace the reference to that node in that location with a oneOf array
        // containing reference to the node and all its children.
        for (const location of locationsToBeUpdated) {
          const slicedLocation = location.slice(1)
          const obj = utils.getObject(spec, slicedLocation)
          if (obj) {
            if (obj['$ref']) delete obj['$ref']
            obj.oneOf = [...this.buildOneOfReferences(node)]
            utils.setObject(spec, slicedLocation, obj)
          }
        }
      }
    }
  }

  /**
   * Creates a PolymorphicTree for a given model in the inheritance chain
   *
   * @param {string} name- Name of the model for which the tree needs to be created.
   * @param {string} discriminator- Name of the property that is marked as the discriminator.
   * @param {Map<string, PolymorphicTree>} subTreeMap- A map that stores a reference to PolymorphicTree for a given model in the inheritance chain.
   * @returns {PolymorphicTree} rootNode- A PolymorphicTree that represents the model in the inheritance chain.
   */
  createPolymorphicTree(
    name: string, discriminator: string, subTreeMap: Map<string, PolymorphicTree>): PolymorphicTree {
    if (name === null
      || name === undefined
      || typeof name.valueOf() !== 'string'
      || !name.trim().length) {
      throw new Error(
        'name is a required property of type string and it cannot be an empty string.')
    }

    if (discriminator === null
      || discriminator === undefined
      || typeof discriminator.valueOf() !== 'string'
      || !discriminator.trim().length) {
      throw new Error(
        'discriminator is a required property of type string and it cannot be an empty string.')
    }

    if (subTreeMap === null || subTreeMap === undefined || !(subTreeMap instanceof Map)) {
      throw new Error('subTreeMap is a required property of type Map.')
    }

    let rootNode = new PolymorphicTree(name)
    let definitions = this.specInJson.definitions

    // Adding the model name or it's discriminator value as an enum constraint with one value (constant) on property marked as discriminator
    if (definitions[name]
      && definitions[name].properties
      && definitions[name].properties[discriminator]) {
      let val = name
      if (definitions[name]['x-ms-discriminator-value']) {
        val = definitions[name]['x-ms-discriminator-value']
      }
      // Ensure that the property marked as a discriminator has only one value in the enum constraint for that model and it
      // should be the one that is the model name or the value indicated by x-ms-discriminator-value. This will make the discriminator
      // property a constant (in json schema terms).
      if (definitions[name].properties[discriminator]['$ref']) {
        delete definitions[name].properties[discriminator]['$ref']
      }
      // We will set "type" to "string". It is safe to assume that properties marked as "discriminator" will be of type "string"
      // as it needs to refer to a model definition name. Model name would be a key in the definitions object/dictionary in the
      // swagger spec. keys would always be a string in a JSON object/dictionary.
      if (!definitions[name].properties[discriminator].type) {
        definitions[name].properties[discriminator].type = 'string'
      }
      definitions[name].properties[discriminator].enum = [`${val}`]
    }

    let children = this.findChildren(name)
    for (let childName of children) {
      let childObj = this.createPolymorphicTree(childName, discriminator, subTreeMap)
      rootNode.addChildByObject(childObj)
    }
    //Adding the created sub tree in the subTreeMap for future use.
    subTreeMap.set(rootNode.name, rootNode)
    return rootNode
  }

  /**
   * Finds children of a given model in the inheritance chain.
   *
   * @param {string} name- Name of the model for which the children need to be found.
   * @returns {Set} result- A set of model names that are the children of the given model in the inheritance chain.
   */
  findChildren(name: string): Set<any> {
    if (name === null
      || name === undefined
      || typeof name.valueOf() !== 'string'
      || !name.trim().length) {
      throw new Error('name is a required property of type string and it cannot be an empty string.')
    }
    let definitions = this.specInJson.definitions
    let reference = `#/definitions/${name}`
    let result = new Set()

    let findReferences = (definitionName: any) => {
      let definition = definitions[definitionName]
      if (definition && definition.allOf) {
        definition.allOf.forEach((item: any) => {
          //TODO: What if there is an inline definition instead of $ref
          if (item['$ref'] && item['$ref'] === reference) {
            log.debug(`reference found: ${reference} in definition: ${definitionName}`)
            result.add(definitionName)
          }
        })
      }
    }

    for (let definitionName of utils.getKeys(definitions)) {
      findReferences(definitionName)
    }

    return result
  }

  /**
   * Builds the oneOf array of references that comprise of the parent and its children.
   *
   * @param {PolymorphicTree} rootNode- A PolymorphicTree that represents the model in the inheritance chain.
   * @returns {PolymorphicTree} result- An array of reference objects that comprise of the parent and its children.
   */
  buildOneOfReferences(rootNode: PolymorphicTree): Set<any> {
    let result = new Set()
    result.add({ "$ref": `#/definitions/${rootNode.name}` })
    for (let entry of rootNode.children.entries()) {
      if (entry[1]) {
        result = new Set([...result, ...this.buildOneOfReferences(entry[1])])
      }
    }
    return result
  }
}

/**
 * @class
 * Creates a tree by traversing the definitions where the parent model is the rootNode and child model is one of it's children.
 */
export class PolymorphicTree {
  name: string
  children: Map<string, PolymorphicTree>
  /**
   * @constructor
   * Initializes a new instance of the PolymorphicTree
   *
   * @param {string} name- The name of the parent model
   * @param {Map<string, PolymorphicTree>} [children] - A map of zero or more children representing the child models in the inheritance chain
   */
  constructor(name: string, children?: Map<string, PolymorphicTree>) {
    if (name === null
      || name === undefined
      || typeof name.valueOf() !== 'string'
      || !name.trim().length) {
      throw new Error('name is a required property of type string and it cannot be an empty string.')
    }

    if (children !== null && children !== undefined && !(children instanceof Map)) {
      throw new Error('children is an optional property of type Map<string, PolymorphicTree>.')
    }
    this.name = name
    this.children = children || new Map()
  }

  /**
   * Adds a child by name to the PolymorphicTree. This method will not add the child again if it is already present.
   *
   * @param {string} childName- The name of the child model
   * @returns {PolymorphicTree} child - The created child node.
   */
  addChildByName(childName: string): PolymorphicTree|undefined {
    if (childName === null
      || childName === undefined
      || typeof childName.valueOf() === 'string'
      || !childName.trim().length) {
      throw new Error('childName is a required parameter of type string.')
    }
    let child
    if (!this.children.has(childName)) {
      child = new PolymorphicTree(childName)
      this.children.set(childName, child)
    } else {
      child = this.children.get(childName)
    }
    return child
  }

  /**
   * Adds a childObject to the PolymorphicTree. This method will not add the child again if it is already present.
   *
   * @param {PolymorphicTree} childObj- A polymorphicTree representing the child model.
   * @returns {PolymorphicTree} childObj - The created child node.
   */
  addChildByObject(childObj: PolymorphicTree): PolymorphicTree {
    if (childObj === null || childObj === undefined || !(childObj instanceof PolymorphicTree)) {
      throw new Error('childObj is a required parameter of type PolymorphicTree.')
    }

    if (!this.children.has(childObj.name)) {
      this.children.set(childObj.name, childObj)
    }
    return childObj
  }
}
